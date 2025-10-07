FROM node:20

WORKDIR /home/app

COPY . /home/app
RUN npm install

EXPOSE 5000
CMD ["node", "/home/app/server.js"]
