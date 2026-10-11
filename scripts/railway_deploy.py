#!/usr/bin/env python3
"""Deploy this project's static frontend to its own Railway service."""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
API = 'https://backboard.railway.com/graphql/v2'
USER_AGENT = 'party-bb-arcade-deployer/1.0'
SERVICE_NAME = 'bb-arcade'
FORBIDDEN_SERVICES = {'frontend', 'backend', 'Postgres'}
REQUIRED_ASSETS = (
    'engine.js',
    'audio.js',
    'lab-ui.js',
    'street-ui.js',
    'main.js',
    'assets/audio/youre-goddamn-right.mp3',
)


def validate_revision(revision):
    if not re.fullmatch(r'[0-9a-f]{40}', revision):
        raise ValueError('revision must be a full 40-character Git commit SHA')


def graphql(token, query, variables=None):
    request = urllib.request.Request(
        API,
        data=json.dumps({'query': query, 'variables': variables or {}}).encode(),
        headers={
            'Content-Type': 'application/json',
            'Project-Access-Token': token,
            'User-Agent': USER_AGENT,
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            payload = json.load(response)
    except urllib.error.HTTPError as error:
        detail = error.read().decode('utf-8', 'replace')
        raise RuntimeError(f'Railway API HTTP {error.code}: {detail[:300]}') from None
    if payload.get('errors') or 'data' not in payload:
        raise RuntimeError('Railway rejected an API operation; verify the project token scope')
    return payload['data']


def token_context(token):
    data = graphql(token, 'query { projectToken { projectId environmentId } }')
    context = data.get('projectToken')
    if not context:
        raise RuntimeError('Railway rejected the project token; check its environment scope')
    return context


def inventory(token, project, environment):
    return graphql(token, '''query($project:String!,$environment:String!){
      project(id:$project){id name services(first:100){edges{node{id name}}}}
      environment(id:$environment,projectId:$project){
        serviceInstances(first:100){edges{node{
          serviceId
          latestDeployment{id status}
          domains{serviceDomains{id domain targetPort}}
        }}}
      }}''', {'project': project, 'environment': environment})


def ensure_service(token, project, environment):
    entries = [edge['node'] for edge in inventory(token, project, environment)['project']['services']['edges']]
    names = [entry['name'] for entry in entries]
    if any(name in FORBIDDEN_SERVICES for name in names):
        raise RuntimeError('Refusing to deploy: this token can see a Conquest service name')
    matches = [entry for entry in entries if entry['name'] == SERVICE_NAME]
    if len(matches) > 1:
        raise RuntimeError(f'Multiple {SERVICE_NAME} services exist; refusing an ambiguous target')
    if matches:
        return matches[0]['id']
    created = graphql(token, '''mutation($input:ServiceCreateInput!){serviceCreate(input:$input){id name}}''',
                      {'input': {'projectId': project, 'environmentId': environment, 'name': SERVICE_NAME}})
    return created['serviceCreate']['id']


def ensure_runtime(token, project, environment, service_id):
    graphql(token, '''mutation($input:VariableCollectionUpsertInput!){variableCollectionUpsert(input:$input)}''',
            {'input': {
                'projectId': project,
                'environmentId': environment,
                'serviceId': service_id,
                'variables': {'PORT': '8080'},
                'replace': False,
                'skipDeploys': True,
            }})
    current = inventory(token, project, environment)
    instances = [edge['node'] for edge in current['environment']['serviceInstances']['edges']
                 if edge['node']['serviceId'] == service_id]
    domains = [domain for instance in instances for domain in instance['domains']['serviceDomains']]
    if any(domain.get('targetPort') not in (None, 8080) for domain in domains):
        raise RuntimeError('Unexpected domain port; refusing to retarget an existing domain')
    if not domains:
        created = graphql(token, '''mutation($input:ServiceDomainCreateInput!){
          serviceDomainCreate(input:$input){domain targetPort}}''',
                          {'input': {'serviceId': service_id, 'environmentId': environment, 'targetPort': 8080}})
        domains = [created['serviceDomainCreate']]
    return f"https://{domains[0]['domain']}"


def stage_sources(root: Path, target: Path, revision: str):
    validate_revision(revision)

    def ignored(directory, names):
        excluded = shutil.ignore_patterns(
            '.git', '.agents', '.claude', '.opencode', '.party', '.env', '.env.*',
            'node_modules', '__pycache__', '.pytest_cache')(directory, names)
        return set(excluded) | {name for name in names if (Path(directory) / name).is_symlink()}

    shutil.copytree(root, target, ignore=ignored)
    (target / 'version.json').write_text(json.dumps({'version': revision, 'service': SERVICE_NAME}) + '\n')


def railway_up(token, project, environment, staged: Path, revision: str):
    env = {key: value for key, value in os.environ.items() if key not in {'RAILWAY_API_TOKEN', 'RAILWAY_TOKEN'}}
    env['RAILWAY_TOKEN'] = token
    env['CI'] = 'true'
    subprocess.run(
        ['railway', 'up', str(staged), '--path-as-root', '--detach', '--ci', '--yes',
         '--service', SERVICE_NAME, '--project', project, '--environment', environment,
         '--message', f'bb-arcade {revision}'],
        check=True,
        env=env,
        cwd=staged,
    )


def latest_status(token, project, environment, service_id):
    current = inventory(token, project, environment)
    instances = [edge['node'] for edge in current['environment']['serviceInstances']['edges']
                 if edge['node']['serviceId'] == service_id]
    deployment = instances[0].get('latestDeployment') if instances else None
    return (deployment or {}).get('status')


def read_bytes(url):
    request = urllib.request.Request(url, headers={'User-Agent': USER_AGENT, 'Cache-Control': 'no-cache'})
    with urllib.request.urlopen(request, timeout=20) as response:
        return response.status, response.read()


def verify_release(public_url, revision, *, attempts=40, pause=time.sleep):
    public_url = public_url.rstrip('/')
    for _ in range(attempts):
        try:
            status, body = read_bytes(public_url + '/version.json')
            version = json.loads(body.decode())
            page_status, page = read_bytes(public_url + '/')
            html = page.decode('utf-8', 'replace')
            assets_ok = page_status == 200 and 'Breaking Bad' in html
            for asset in REQUIRED_ASSETS:
                asset_status, _ = read_bytes(f'{public_url}/{asset}')
                assets_ok = assets_ok and asset_status == 200
            if status == 200 and version.get('version') == revision and version.get('service') == SERVICE_NAME and assets_ok:
                return
        except (urllib.error.URLError, TimeoutError, ValueError, KeyError):
            pass
        pause(5)
    raise RuntimeError('Published frontend did not become ready at the expected revision')


def deploy(root: Path, revision: str):
    token = os.environ.get('RAILWAY_TOKEN', '').strip()
    if not token:
        raise ValueError('Set RAILWAY_TOKEN to the project environment token')
    validate_revision(revision)
    context = token_context(token)
    project, environment = context['projectId'], context['environmentId']
    service_id = ensure_service(token, project, environment)
    public_url = ensure_runtime(token, project, environment, service_id)
    with tempfile.TemporaryDirectory(prefix='bb-arcade-release-') as temp:
        staged = Path(temp) / 'app'
        stage_sources(root, staged, revision)
        railway_up(token, project, environment, staged, revision)
    deadline = time.monotonic() + 300
    while time.monotonic() < deadline:
        status = latest_status(token, project, environment, service_id)
        if status == 'SUCCESS':
            break
        if status in {'FAILED', 'CRASHED', 'REMOVED'}:
            raise RuntimeError(f'Railway deployment {status}; last healthy release was left in place')
        time.sleep(5)
    else:
        raise RuntimeError('Railway deployment did not finish; last healthy release was left in place')
    verify_release(public_url, revision)
    print(f'Published bb-arcade {revision}: {public_url}')
    summary = os.environ.get('GITHUB_STEP_SUMMARY')
    if summary:
        with open(summary, 'a') as handle:
            handle.write(f'bb-arcade published: [{public_url}]({public_url})\n\nCommit: `{revision}`\n')
    return public_url


if __name__ == '__main__':
    try:
        deploy(ROOT, os.environ.get('GITHUB_SHA') or os.environ.get('DEPLOY_REVISION', ''))
    except (ValueError, RuntimeError, subprocess.CalledProcessError, urllib.error.URLError) as error:
        print(f'Deployment failed: {error}', file=sys.stderr)
        raise SystemExit(1)
