FROM node:22-alpine AS frontend-builder
WORKDIR /app
COPY package.json .
RUN npm install
COPY . .
EXPOSE 80
CMD ["npm", "run", "dev", "--", "--host"]