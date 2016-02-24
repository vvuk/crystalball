"use strict";
function makeWeights(bucketCountData, fromChannel, toChannel)
{
  let fromBuckets = bucketCountData[fromChannel];
  let toBuckets = bucketCountData[toChannel];

  if (!fromBuckets) {
    throw new Error("Can't find channel '" + fromChannel + "' in bucket count data");
  }
  if (!toBuckets) {
    throw new Error("Can't find channel '" + toChannel + "' in bucket count data");
  }

  let fromBucketsByName = {};
  for (let fb of fromBuckets.buckets) {
    fromBucketsByName[fb.name] = fb;
  }

  let bucketWeights = [];
  for (let tb of toBuckets.buckets) {
    let fb = fromBucketsByName[tb.name];
    if (!fb) {
      throw new Error("Couldn't find from bucket " + tb.name);
    }

    let weight = fb.percentMatched / tb.percentMatched;
    if (tb.percentMatched == 0 || fb.percentMatched == 0) {
      weight = 0.0001; // small, but not Infinity or zero
    }
    bucketWeights.push({ name: tb.name, weight: weight });
  }
  return bucketWeights;
}

module.exports.makeWeights = makeWeights;

if (require.main == module) {
  const jsonfile = require('jsonfile');

  let args = process.argv.slice(2);
  if (args.length != 3) {
    console.error("Usage: weight.js bucketcounts.json fromChannel toChannel");
    return;
  }

  let bucketCounts = jsonfile.readFileSync(args[0]);
  let weights = makeWeights(bucketCounts, args[1], args[2]);
  for (let w of weights) {
    console.log(w.weight.toFixed(3), w.name);
  }
}
