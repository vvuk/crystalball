"use strict";
const cmdline = require('command-line-args');
const jsonfile = require('jsonfile');

function makeWeights(outFile, fromFile, toFile)
{
  let fromBuckets = jsonfile.readFileSync(fromFile);
  let toBuckets = jsonfile.readFileSync(toFile);

  let fromBucketsByName = {};
  for (let fb of fromBuckets.buckets) {
    fromBucketsByName[fb.name] = fb;
  }

  let bucketWeights = [];
  for (let tb of toBuckets.buckets) {
    let fb = fromBucketsByName[tb.name];
    if (!fb) {
      console.error("Couldn't find from bucket", tb.name);
      return;
    }

    let weight = fb.percentMatched / tb.percentMatched;
    if (tb.percentMatched == 0 || fb.percentMatched == 0) {
      weight = 0.0001; // small, but not Infinity or zero
    }
    bucketWeights.push({ name: tb.name, weight: weight });
    console.log(weight, tb.name);
  }

  jsonfile.writeFile(outFile, bucketWeights);
  console.log("Wrote", outFile);
}

if (require.main == module) {
  let cli = cmdline([
    { name: 'out', alias: 'o', type: String },
    { name: 'src', ailas: 's', type: String, multiple: true, defaultOption: true }
  ]);

  const opts = cli.parse();
  let args = opts["src"];
  if (args.length != 2) {
    console.error("Usage: weight.js -o weights.json from-data.json to-data.json");
    return;
  }

  makeWeights(opts["out"], args[0], args[1]);
}
