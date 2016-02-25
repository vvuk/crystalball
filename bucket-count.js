"use strict";
const importData = require('./import-data.js');
const sift = require('sift');
const es = require('event-stream');
const cmdline = require('command-line-args');
const jsonfile = require('jsonfile');
const cluster = require('cluster');

let buckets = null;

function doQueries(recsByChannel, bucketResultsByChannel)
{
  for (let channel in recsByChannel) {
    let recs = recsByChannel[channel];
    let result =
      bucketResultsByChannel[channel] =
      bucketResultsByChannel[channel] || { totalCount: 0, matchedCount: 0, bucketCounts: {} };
    for (let bucket of buckets) {
      let resultBucket =
        result.bucketCounts[bucket.name] =
        result.bucketCounts[bucket.name] || { count: 0 };

      let c = recs.filter(bucket._sifter).length;
      resultBucket.count += c;
      result.matchedCount += c;
    }
    result.totalCount += recs.length;
  }
}

function printReport(bucketResultsByChannel, verbose)
{
  let grandTotalRecords = 0;
  for (let channel in bucketResultsByChannel) {
    grandTotalRecords += bucketResultsByChannel[channel].totalCount;
  }

  console.log("Processed", grandTotalRecords, "records");
  if (verbose) {
    console.log("---------------------");
    for (let channel in bucketResultsByChannel) {
      let r = bucketResultsByChannel[channel];
      console.log("Channel:", channel);
      console.log("Total records:", r.totalCount);
      for (let bucketName in r.bucketCounts) {
        let bucketCount = r.bucketCounts[bucketName];
        console.log(bucketName, bucketCount.count, (bucketCount.count * 100 / r.totalCount).toFixed(2) + "%");
      }
    }
  }
}

function saveFile(bucketResultsByChannel, outFile, doUpdate)
{
  let oldData;

  if (doUpdate) {
    var d = jsonfile.readFileSync(outFile, { "throws": false });
    if (d) {
      oldData = d;
    } else {
      console.error("Failed to load old data for update");
    }
  }

  let channelJsonData = {};
  for (let channel in bucketResultsByChannel) {
    let r = bucketResultsByChannel[channel];
    let totalCount = r.totalCount;
    let matchedCount = r.matchedCount;

    let jsonData = {
      totalCount: totalCount,
      matchedCount: matchedCount,
      buckets: []
    };

    let bucketsByName = {};
    for (let bucketName in r.bucketCounts) {
      let bucketCount = r.bucketCounts[bucketName];
      let c = bucketCount.count;
      let b = {
        name: bucketName,
        count: c,
        percent: c / totalCount,
        percentMatched: c / matchedCount
      };
      jsonData['buckets'].push(b);
      bucketsByName[bucketName] = b;
    }

    if (oldData) {
      totalCount += oldData[channel].totalCount;
      matchedCount += oldData[channel].matchedCount;
      jsonData.totalCount = totalCount;
      jsonData.matchedCount = matchedCount;

      for (let ob of oldData[channel].buckets) {
        let nb = bucketsByName[ob.name];
        if (!nb) {
          continue;
        }
        nb.count += ob.count;
        nb.percent = nb.count / totalCount;
        nb.percentMatched = nb.count / matchedCount;
      }
    }

    channelJsonData[channel] = jsonData;
  }

  jsonfile.writeFile(outFile, channelJsonData, function(err) {
    if (err) {
      console.error("Failed to write", outFile, err);
    } else {
      console.log(oldData ? "Updated" : "Wrote", outFile);
    }
  });
}

const NUM_RECORDS = 5000;

function doImportData(src, endCallback)
{
  let recordCount = 0;
  let bucketResultsByChannel = {};
  let recsByChannel = {};

  let dataStream = es.mapSync(
    function (d) {
      let channel = d['channel'];
      if (!channel) {
        // something ancient, likely Firefox 3.0 or 3.5
        return;
      }

      // every NUM_RECORDS, run the queries
      if (recordCount > 0 && (recordCount % NUM_RECORDS) == 0) {
        doQueries(recsByChannel, bucketResultsByChannel);
        recsByChannel = {};
      }

      recsByChannel[channel] = recsByChannel[channel] || [];
      recsByChannel[channel].push(d);
      recordCount++;
    });
  dataStream.on('end', function() {
    doQueries(recsByChannel, bucketResultsByChannel);
    endCallback(bucketResultsByChannel);
  });

  importData.loadAllData([ src ], dataStream);
}

function mergeResults(result, mergedResults)
{
  // merge result into mergedResults
  for (let channel in result) {
    if (!(channel in mergedResults)) {
      // doesn't exist, just take it
      mergedResults[channel] = result[channel];
    } else {
      // merge
      let data = mergedResults[channel];
      let newData = result[channel];
      data.totalCount += newData.totalCount;
      data.matchedCount += newData.matchedCount;
      for (let bucketName in newData.buckets) {
        if (!(bucketName in data.buckets)) {
          data.buckets[bucketName] = newData.buckets[bucketName];
        } else {
          data.buckets[bucketName].count += newData.buckets[bucketName].count;
        }
      }
    }
  }
}

if (require.main == module && cluster.isMaster) {
  let cli = cmdline([
    { name: 'out', alias: 'o', type: String },
    { name: 'update', alias: 'u', type: Boolean },
    { name: 'buckets', alias: 'b', type: String },
    { name: 'verbose', alias: 'v', type: Boolean },
    { name: 'in', ailas: 'i', type: String, multiple: true, defaultOption: true }
  ]);

  const opts = cli.parse();
  let args = opts["in"];
  let outFile = opts["out"];
  let outFileUpdate = opts["update"];
  let verbose = opts["verbose"];

  let bucketModule = opts["buckets"];
  if (bucketModule) {
    if (bucketModule.indexOf("/") == -1) {
      bucketModule = "./" + bucketModule;
    }
  } else {
    console.log("Using ./buckets.js");
    bucketModule = "./buckets.js";
  }

  if (!args || args.length == 0) {
    console.error("Must specify some dates or files");
    process.exit(1);
  }

  let workItems = importData.expandSourceArgs(args);
  let numResultsOutstanding = workItems.length;
  let gBucketResultsByChannel = {};

  function dispatchNextWorkItem(workerId) {
    let src = workItems.shift();
    if (!src)
      return;
    cluster.workers[workerId].send({ cmd: "processData", src: src });
  }

  // callback from children when data result is available
  function dataResultHandler(msg) {
    if (msg.cmd == "processResult") {
      console.log("Got result for", msg.src, "still waiting for", numResultsOutstanding-1);
      mergeResults(msg.result, gBucketResultsByChannel);

      // Are there still more?
      if (--numResultsOutstanding > 0) {
        dispatchNextWorkItem(msg.workerId);
        return;
      }

      printReport(gBucketResultsByChannel, verbose);

      if (outFile) {
        saveFile(gBucketResultsByChannel, outFile, outFileUpdate);
      }

      cluster.disconnect();
    }
  }

  // set up our worker cluster, based on the number of CPUs
  const numWorkers = require('os').cpus().length;
  let workers = [];
  for (let i = 0; i < numWorkers; ++i) {
    let w = cluster.fork();
    w.on('message', dataResultHandler);
    w.send({ cmd: "configure", buckets: bucketModule });

    // give it a work item
    dispatchNextWorkItem(w.id);
  }
} else if (cluster.isWorker) {
  process.on('message', function (msg) {
    if (msg.cmd == "configure") {
      buckets = require(msg.buckets).buckets;
      for (let bucket of buckets) {
        bucket._sifter = sift(bucket.query);
      }
      return;
    }

    if (msg.cmd == "processData") {
      //console.log("processing", msg.src);
      doImportData(msg.src, function (results) {
        process.send({ cmd: 'processResult', workerId: cluster.worker.id, src: msg.src, result: results });
      });
      return;
    }
  });
}

