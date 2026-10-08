FROM mcr.microsoft.com/playwright:v1.56.1-noble
USER root
RUN apt-get update && apt-get install -y --no-install-recommends xvfb x11vnc novnc websockify && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
ENV DISPLAY=:99 NODE_ENV=production EXECUTOR_DATA_DIR=/data
CMD ["node", "server.js"]
