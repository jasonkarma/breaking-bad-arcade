FROM caddy:2-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY . /srv
ENV PORT=8080
EXPOSE 8080
