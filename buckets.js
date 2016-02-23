"use strict";

const INTEL     = 0x8086;
const NVIDIA    = 0x10de;
const AMD       = 0x1022;
const ATI       = 0x1002;
const MICROSOFT = 0x1414;

// add a matrix of each bucket from buckets1 and each bucket of buckets2,
// merging the queries
function addBucketMatrix(buckets1, buckets2)
{
  for (let b1 of buckets1) {
    for (let b2 of buckets2) {
      let newName = b1.name + ", " + b2.name;
      let newQuery = Object.assign({}, b1.query, b2.query);
      buckets.push({ name: newName, query: newQuery });
    }
  }
}

let buckets = [
  { name: "Linux",
    query: {
      "platform": "Linux"
    }},
  { name: "Mac OS X",
    query: {
      "platform": "Mac OS X"
    }},
];

addBucketMatrix([ 
  { name: "Windows XP",
    query: {
      "platform": "Windows NT",
      "pv_v0": 5
    }},
  { name: "Windows Vista",
    query: {
      "platform": "Windows NT",
      "pv_v0": 6,
      "pv_v1": 0
    }},
 { name: "Windows 7",
    query: {
      "platform": "Windows NT",
      "pv_v0": 6,
      "pv_v1": 1
    }},
  { name: "Windows 8",
    query: {
      "platform": "Windows NT",
      "pv_v0": 6,
      "pv_v1": { $gte: 2 }
    }},
  { name: "Windows 10",
    query: {
      "platform": "Windows NT",
      "pv_v0": 10
    }},
], [
  { name: "Single Intel GPU",
    query: {
      "gpu0_vendor": INTEL,
      "gpu_count": 1
    }},
  { name: "Single NVIDIA GPU",
    query: {
      "gpu0_vendor": NVIDIA,
      "gpu_count": 1
    }},
  { name: "Intel + NVIDIA GPU",
    query: {
      "gpu0_vendor": INTEL,
      "gpu1_vendor": NVIDIA,
      "gpu_count": 2
    }},
  { name: "Non-Intel/NVIDIA GPU",
    query: {
      "gpu0_vendor": { $nin: [ INTEL, NVIDIA ] }
    }},
]);

module.exports.buckets = buckets;
