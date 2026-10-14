# Build the web app, then serve the static files with nginx (which also
# forwards /api and /ws to the API container, so the page has one origin).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
# openssl: a self-signed certificate is made on first start (HTTPS for phone cameras).
RUN apk add --no-cache openssl
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY docker/40-self-signed-cert.sh /docker-entrypoint.d/40-self-signed-cert.sh
RUN chmod +x /docker-entrypoint.d/40-self-signed-cert.sh
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080 8443
