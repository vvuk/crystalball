
## TODO

1. Process all channels at once; generate bucket counts for all channels in a single file
2. Remove weight.js, topcrash.js should just take a from/to channel
3. Make sure all commands have a -b buckets arg, instead of just assuming ./buckets.js (also put in ./ if needed)
4. Figure out how to parallelize -- all steps could easily be parallel per day with a marge step
5. Add usage/command line arg info to all commands


## Example usage

Create `apikey.js` with `module.exports.apikey = "...";`.

Count all release crashes in buckets
    $ node ./query.js -o out/2016-01-release-buckets.json -c release 2016-01

Do the same for beta crashes
    $ node ./query.js -o out/2016-01-beta-buckets.json -c beta 2016-01

Compute weights to project beta onto release
    $ node ./weight.js -o out/2016-01-beta-to-release-weights.json out/2016-01-release-buckets.json out/2016-01-beta-buckets.json

Compute beta topcrashes
    $ node ./topcrash.js -b ./buckets.js -c beta 2016-01

Compute beta topcrashes, with weights applied
    $ node ./topcrash.js -w out/2016-01-beta-to-release-weights.json -b ./buckets.js -c beta 2016-01
