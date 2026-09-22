# Some other team's site: static files behind nginx, nothing to do with telamon
# or Node. It embeds the docs and reads their API from the reader's browser.
FROM nginxinc/nginx-unprivileged:stable-alpine
COPY default.conf.template /etc/nginx/templates/default.conf.template
COPY index.html main.js style.css /usr/share/nginx/html/
# As the browser reaches it, not as this container would: the iframe and the
# fetch both run on the reader's machine.
ENV DOCS_URL=http://localhost:3000
EXPOSE 8080
