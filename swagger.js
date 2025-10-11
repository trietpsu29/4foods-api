const swaggerAutogen = require("swagger-autogen")();

const doc = {
  info: {
    title: "4Foods API",
    description: "API documentation for 4Foods android app",
  },
  host: "api.4foods.app",
  schemes: ["https"],
};

const outputFile = "./swagger_output.json";
const endpointsFiles = ["./server.js"];

swaggerAutogen(outputFile, endpointsFiles, doc);
