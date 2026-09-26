const express = require("express");
const app = express();
app.use(express.json());

app.get("/hello", (req, res) => {
  res.send("<h1>Hello " + req.query.name + "</h1>");
});

app.post("/calc", (req, res) => {
  res.json({ result: eval(req.body.expr) });
});

module.exports = app;
