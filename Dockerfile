# Kestrel digital twin: viewer, REST API, MQTT broker and OPC UA server in one container.
FROM node:20-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY shared ./shared
COPY server ./server
COPY public ./public
COPY docs ./docs
# inside a container the services must listen on all interfaces; publish only the ports you need
ENV HOST=0.0.0.0 HTTP_PORT=8080 MQTT_PORT=1883 OPCUA_PORT=4840 SOURCE=internal
EXPOSE 8080 1883 4840
USER node
CMD ["node", "server/index.js"]
