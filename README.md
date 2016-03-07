
## Setup
```npm install```

Create an API key on crash-stats.mozilla.com.  Create `apikey.js` with `module.exports.apikey = "...";`.  This will be used to download the raw data.

A note on downloads: each day's crash data is downloaded and cached in the cache directory.  As such, each day will only be downloaded once.  The server-side component generating the data is poorly written and will cause memory issues if too many days' worth of crashes are requested in parallel; therefore, when requesting a new date range, it's often better to run import-data.js directly first to download it (serially), and then run one of the other tools using cached data.

Specifying data and date ranges:
* 2016-01 All days in January, 2016
* 2016-01-17 January 17, 2016
* 2016-01:2016-02 January 1, 2016 to February 29, 2016
* 2016-01-15:2016-02-20 January 15, 2016 to February 20, 2016
* 2016-01:2016-02-20 January 1, 2016 to February 20, 2016
* You can also directly specify a path to a csv file to parse, which can optionally be gzip'd (e.g. cache/2016-01-01.csv.gz)

## Buckets

All the tools can optionally operate using a set of buckets, which are in turn written as sift.js (effectively MongoDB) queries.  See buckets.js for some sample buckets.  See https://www.npmjs.com/package/sift for sift.js query syntax. The bucket file is evaluated as a node module, so helper functions etc. can be used to create the buckets array and queries.

## Tools

### import-data.js

This contains the import code and is used by all other tools.  It can be run directly to pull data from the server and cache it locally.  If this is done, it will also dump every 10,000th report document, which can show the available fields.  If new fields need to be added, import-data.js has the parsing code to edit.  Only arguments are data args.

Example usage:
```
$ node ./import-data.js 2016-01:2016-02
```

### bucket-count.js

Using a given bucket definition file (defaulting to ./buckets.js), make a count of all crashes that match those buckets in the given date ranges/data sources.  The counts are always separated into channels.  This file is used as input into the weight-generating or topcrash tools.

Example usage:

Count all bucketed crashes for 2016-01, using bucket definitions in `buckets.js`.  Write output to `out/2016-01-bucket-counts.json`.
```
$ node ./bucket-count.js -b ./buckets.js -o out/2016-01-bucket-counts.json 2016-01
```

A -u option can be used to update an existing count file with additional data.  For example, the following will result in 2016-bucket-counts.json containing data as if 2016-01:2016-03 were specified in the first command.
```
$ node ./bucket-count.js -b ./buckets.js -o out/2016-bucket-counts.json 2016-01
$ node ./bucket-count.js -b ./buckets.js -o out/2016-bucket-counts.json -u 2016-02
$ node ./bucket-count.js -b ./buckets.js -o out/2016-bucket-counts.json -u 2016-03
```


### weight.js

This tool creates a weight file, assigning a multiplier to each bucket, based on the frequency it is seen in the given ranges.

For example, a static weight file can be generated to project the beta topcrash list to look as if it was run on the release population.  The counts file is specified separately for each of the src and dest bucket counts, and can be different.  This is so that different date ranges can be used for the count files.
```
$ node ./weight.js out/2016-01-bucket-counts.json release out/2016-01-bucket-counts.json beta beta-as-release.json
```

### topcrash.js

Compute topcrash lists based on various input parameters.

Compute overall beta topcrashes
```
$ node ./topcrash.js -c beta 2016-01
```

Compute beta topcrashes, as if it was the release population.  (`-b` bucket file; `-f` bucket count file; `-c` channel; `-m` map channel)
```
$ node ./topcrash.js -b ./buckets.js -f out/2016-01-bucket-counts.json -c beta -m release 2016-01
```

Use a static weight file for topcrashes.
```
$ node ./topcrash.js -b ./buckets.js -f out/2016-01-bucket-counts.json -c beta -w beta-as-release.json 2016-01
```

## Samples

Count all bucketed crashes for 2016-01, using bucket definitions in `buckets.js`.  Write output to `out/2016-01-bucket-counts.json`.
```
$ node ./bucket-count.js -b ./buckets.js -o out/2016-01-bucket-counts.json 2016-01
```

Compute overall beta topcrashes
```
$ node ./topcrash.js -c beta 2016-01
```
    
Compute beta topcrashes, ignoring crashes that don't match a bucket
```
$ node ./topcrash.js -b ./buckets.js -c beta 2016-01
```

Compute beta topcrashes, as if it was the release population.  (`-b` bucket file; `-f` bucket count file; `-c` channel; `-m` map channel)
```
$ node ./topcrash.js -b ./buckets.js -f out/2016-01-bucket-counts.json -c beta -m release 2016-01
```

Generate a static weight file.  Note that the counts file is specified separately for each of the src and dest bucket counts, and can be different.  This is so that different date ranges can be used for the count files.
```
$ node ./weight.js out/2016-01-bucket-counts.json release out/2016-01-bucket-counts.json beta beta-as-release.json
```

Use a static weight file for topcrashes.
```
$ node ./topcrash.js -b ./buckets.js -f out/2016-01-bucket-counts.json -c beta -w beta-as-release.json 2016-01
```

## TODO (out of date)

1. Process all channels at once; generate bucket counts for all channels in a single file
2. Remove weight.js, topcrash.js should just take a from/to channel
3. Make sure all commands have a -b buckets arg, instead of just assuming ./buckets.js (also put in ./ if needed)
4. Add usage/command line arg info to all commands

