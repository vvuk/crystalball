
const INTEL     = 0x8086;
const NVIDIA    = 0x10de;
const AMD       = 0x1022;
const ATI       = 0x1002;
const MICROSOFT = 0x1414;

module.exports.buckets = [
  { name: "Linux",
    query: {
      "platform": "Linux"
    }},
  { name: "Windows, Single Intel GPU",
    query: {
      "platform": "Windows NT",
      "gpu0_vendor": INTEL,
      "gpu_count": 1
    }},
  { name: "Windows, Single NVIDIA GPU",
    query: {
      "platform": "Windows NT",
      "gpu0_vendor": NVIDIA,
      "gpu_count": 1
    }},
  { name: "Windows, Intel + NVIDIA GPU",
    query: {
      "platform": "Windows NT",
      "gpu0_vendor": INTEL,
      "gpu1_vendor": NVIDIA,
      "gpu_count": 2
    }},
];

