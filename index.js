const express = require("express");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = 3001;

app.use(express.static(path.join(__dirname, "public")));

app.listen(PORT, () => {
  console.log(`Running at http://localhost:${PORT}`);
});