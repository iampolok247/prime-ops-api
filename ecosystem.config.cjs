module.exports = {
  apps: [
    {
      name: "prime.server",
      script: "./server.js",
      args: "start",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
