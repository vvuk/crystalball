"use strict";
const importData = require('./import-data.js');
const sift = require('sift');
const es = require('event-stream');
const cmdline = require('command-line-args');
const jsonfile = require('jsonfile');
const cluster = require('cluster');
const printf = require('printf');

let buckets = null;
let hasWeights = false;

function doQueries(recs, topCrashes, unweightedTopCrashes)
{
  for (let bucket of buckets) {
    let matched = recs.filter(bucket._sifter);
    for (let m of matched) {
      let w = bucket._weight;
      let sig = m['signature'];
      topCrashes[sig] = (topCrashes[sig] || 0) + w;
      unweightedTopCrashes[sig] = (unweightedTopCrashes[sig] || 0) + 1;
    }
  }
}

function makeCrashArray(crashes)
{
  if (!crashes)
    return null;

  let crashArray = [];
  for (let sig in crashes) {
    crashArray.push({"sig": sig, "count": crashes[sig]});
  }
  crashArray.sort(function(a, b) {
    return b.count - a.count;
  });
  return crashArray;
}

function printReport(topCrashes, unweightedTopCrashes, numCrashes)
{
  let wCrashArray = makeCrashArray(topCrashes);
  let uCrashArray = makeCrashArray(unweightedTopCrashes);

  if (uCrashArray) {
    // figure out the position change for each weighted crash
    for (let i = 0; i < Math.min(numCrashes, wCrashArray.length); ++i) {
      let uIndex = 0;
      while (uIndex < uCrashArray.length) {
        if (uCrashArray[uIndex].sig == wCrashArray[i].sig)
          break;
        uIndex++;
      }
      if (uIndex == uCrashArray.length) {
        console.error("Crash with signature '" + wCrashArray[i].sig + "' in weighted list, but not in unweighted?!");
      }
      wCrashArray[i]['change'] = uIndex - i;
    }

    printf(process.stdout, "\n==== Top Crashes (unweighted) ====\n");
    for (let i = 0; i < Math.min(numCrashes, uCrashArray.length); ++i) {
      printf(process.stdout, "%3d: %11.2f  %s\n", i+1, uCrashArray[i].count, uCrashArray[i].sig);
    }

    printf(process.stdout, "\n==== Top Crashes (weighted) ====\n");
    for (let i = 0; i < Math.min(numCrashes, wCrashArray.length); ++i) {
      let c = wCrashArray[i];
      let deltaStr = "      ";
      if (c.change) {
        let sign = c.change < 0 ? "-" : "+";
        let abs = Math.abs(c.change);
        deltaStr = printf("(%s%3d)", sign, abs);
      }

      printf(process.stdout, "%s%3d: %11.2f  %s\n", deltaStr, i+1, c.count, c.sig);
    }


  } else {
    printf(process.stdout, "\n==== Top Crashes ====\n");
    for (let i = 0; i < Math.min(numCrashes, wCrashArray.length); ++i) {
      printf(process.stdout, "%3d: %11.2f  %s\n", i+1, wCrashArray[i].count, wCrashArray[i].sig);
    }
  }
}

const NUM_RECORDS = 5000;

function doTopCrashes(src, endCallback)
{
  let recordCount = 0;
  let records = [];
  let topCrashes = {};
  let unweightedTopCrashes = {};

  let handlingStream = es.mapSync(
    function (d) {
      if (recordCount > 0 && (recordCount % NUM_RECORDS) == 0) {
        doQueries(records, topCrashes, unweightedTopCrashes);
        records = [];
      }
      records.push(d);
      recordCount++;
  });
  handlingStream.on('end', function() {
    doQueries(records, topCrashes, unweightedTopCrashes);
    endCallback([topCrashes, unweightedTopCrashes]);
  });

  importData.loadAllData([ src ], handlingStream);
}

function mergeResults(results, mergedResults, unweightedMergedResults)
{
  for (let k = 0; k < 2; ++k) {
    if (!results[k])
      continue;
    let i = results[k];
    let o = (k == 0) ? mergedResults : unweightedMergedResults;
    for (let crashSig in i) {
      if (crashSig in o) {
        o[crashSig] += i[crashSig];
      } else {
        o[crashSig] = i[crashSig];
      }
    }
  }
}

function configureBucketAndWeights(bucketModule, bucketCounts, channel, mapChannel, weightFile, firefoxMajorVersion)
{
  if (bucketModule) {
    buckets = require(bucketModule).buckets;
  } else {
    // set up a dummy "All" bucket
    buckets = [ { name: "All", query: {} } ];
  }

  let weightsByName = null;
  let weightData = null;
  if (bucketCounts && mapChannel) {
    let bucketCountData = jsonfile.readFileSync(bucketCounts);
    weightData = weight.makeWeights(bucketCountData, mapChannel, bucketCountData, channel);
  } else if (weightFile) {
    weightData = jsonfile.readFileSync(weightFile);
  }

  if (weightData) {
    hasWeights = true;
    weightsByName = {};
    for (let w of weightData) {
      weightsByName[w['name']] = w['weight'];
    }
  }

  for (let bucket of buckets) {
    if (channel) {
      bucket.query["channel"] = channel;
    }
    if (firefoxMajorVersion) {
      bucket.query["v_v0"] = firefoxMajorVersion;
    }

    bucket._sifter = sift(bucket.query);
    if (weightsByName) {
      if (!(bucket['name'] in weightsByName)) {
        throw new Error("Can't find weight for bucket " + bucket['name']);
      }

      bucket._weight = weightsByName[bucket['name']];
    } else {
      bucket._weight = 1;
    }
  }
}

if (require.main == module && cluster.isMaster) {
  let cli = cmdline([
    // the bucket module
    { name: 'buckets', alias: 'b', type: String },
    // the bucket counts file, as generated by bucket-counts.json
    { name: 'bucketcounts', alias: 'f', type: String },
    // the channel to show topcrash list for
    { name: 'channel', alias: 'c', type: String },
    // the channel to use as a population map; e.g. channel beta, mapchannel release to show beta
    // topcrashes as if they were happening on release
    { name: 'mapchannel', alias: 'm', type: String },
    // weight file, to use instead of mapchannel
    { name: 'weights', alias: 'w', type: String },
    { name: 'verbose', alias: 'v', type: Boolean },
    { name: 'firefox', alias: 'r', type: Number },
    { name: 'num', alias: 'n', type: Number },
    { name: 'src', ailas: 's', type: String, multiple: true, defaultOption: true }
  ]);

  const opts = cli.parse();
  let args = opts["src"];
  let verbose = opts["verbose"];
  let numCrashes = opts["num"] || 25;

  let bucketModule = opts["buckets"];
  if (bucketModule) {
    if (bucketModule.indexOf("/") == -1) {
      bucketModule = "./" + bucketModule;
    }
  }

  if (!args || args.length == 0) {
    console.error("Must specify some dates or files");
    process.exit(1);
  }

  let workItems = importData.expandSourceArgs(args);
  let numResultsOutstanding = workItems.length;
  let gTopCrashes = {};
  let gUnweightedTopCrashes = {};

  function dispatchNextWorkItem(workerId) {
    let src = workItems.shift();
    if (!src)
      return;
    cluster.workers[workerId].send({ cmd: "processData", src: src });
  }

  // callback from children when data result is available
  function dataResultHandler(msg) {
    if (msg.cmd == "processResult") {
      printf(process.stdout, "Got result for %s, waiting on %d more\n", msg.src, numResultsOutstanding-1);
      mergeResults(msg.result, gTopCrashes, gUnweightedTopCrashes);

      // Are there still more?
      if (--numResultsOutstanding > 0) {
        dispatchNextWorkItem(msg.workerId);
        return;
      }

      printReport(gTopCrashes, hasWeights ? gUnweightedTopCrashes : null, numCrashes);

      cluster.disconnect();
    }
  }

  configureBucketAndWeights(bucketModule, opts['bucketcounts'], opts['channel'], opts['mapchannel'], opts['weights'],
                           opts["firefox"]);

  // set up our worker cluster, based on the number of CPUs
  const numWorkers = require('os').cpus().length;
  let workers = [];
  for (let i = 0; i < numWorkers; ++i) {
    let w = cluster.fork();
    w.on('message', dataResultHandler);
    w.send({ cmd: "configure", buckets: bucketModule, opts: opts });

    // give it a work item
    dispatchNextWorkItem(w.id);
  }
} else if (cluster.isWorker) {
  process.on('message', function (msg) {
    if (msg.cmd == "configure") {
      configureBucketAndWeights(msg.buckets, msg.opts['bucketcounts'], msg.opts['channel'],
                                msg.opts['mapchannel'], msg.opts['weights'], msg.opts['firefox']);
      return;
    }

    if (msg.cmd == "processData") {
      //console.log("processing", msg.src);
      doTopCrashes(msg.src, function (results) {
        process.send({ cmd: 'processResult', workerId: cluster.worker.id, src: msg.src, result: results });
      });
      return;
    }
  });
}


