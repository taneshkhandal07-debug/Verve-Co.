/**
 * Vercel Serverless Function entry point
 * Bridges serverless HTTP requests directly to the canonical Express app in razorpay-agent-server.js.
 */
const app = require("../razorpay-agent-server.js");

module.exports = (req, res) => {
  return app(req, res);
};
