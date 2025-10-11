const swaggerAutogen = require("swagger-autogen")();

const outputFile = "./swagger_output.json";
const endpointsFiles = ["./server.js"];

const doc = {
  info: {
    title: "4Foods API",
    description: "API documentation for 4Foods android app",
  },
  host: "api.4foods.app",
  schemes: ["https"],
  consumes: ["application/json"],
  produces: ["application/json"], // 👈 ensure JSON responses
};

swaggerAutogen(outputFile, endpointsFiles, doc);
