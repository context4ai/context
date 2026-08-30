const { format: formatValue } = require("./format.cjs");

function legacyRun(input) {
  return formatValue(input);
}

exports.legacyRun = legacyRun;
module.exports.alias = legacyRun;
