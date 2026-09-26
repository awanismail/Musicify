const fs = require("fs");
const path = require("path");

const localConfigPath = path.join(__dirname, "..", "config.js");

if (fs.existsSync(localConfigPath)) {
    module.exports = require("../config.js");
} else {
    module.exports = require("../config.example.js");
}
