
## TODO

1. Process all channels at once; generate bucket counts for all channels in a single file
2. Remove weight.js, topcrash.js should just take a from/to channel
3. Make sure all commands have a -b buckets arg, instead of just assuming ./buckets.js (also put in ./ if needed)
4. Figure out how to parallelize -- all steps could easily be parallel per day with a marge step
5. Add usage/command line arg info to all commands

## Setup
```npm install```

## Example usage

Create `apikey.js` with `module.exports.apikey = "...";`.

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

