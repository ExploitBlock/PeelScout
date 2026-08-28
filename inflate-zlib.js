/** Minimal zlib inflate (header 0x78). Enough for Egress Base64Url payloads. */
function inflateZlib(bytes) {
  if (!bytes || bytes.length < 6) throw new Error("short");
  if (bytes[0] !== 0x78) throw new Error("not zlib");
  const src = bytes;
  let bitPos = 16;
  function bits(n) {
    let v = 0, g = 0;
    while (g < n) {
      const bi = bitPos >> 3;
      if (bi >= src.length) throw new Error("oob");
      v |= ((src[bi] >> (bitPos & 7)) & 1) << g;
      bitPos++;
      g++;
    }
    return v;
  }
  const out = [];
  const litLenBase = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
  const litLenExtra = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
  const distBase = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
  const distExtra = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
  function buildHuff(lengths) {
    const max = Math.max.apply(null, lengths);
    const blCount = new Array(max + 1).fill(0);
    for (let i = 0; i < lengths.length; i++) if (lengths[i]) blCount[lengths[i]]++;
    const nextCode = new Array(max + 1).fill(0);
    let code = 0;
    for (let bitsN = 1; bitsN <= max; bitsN++) {
      code = (code + blCount[bitsN - 1]) << 1;
      nextCode[bitsN] = code;
    }
    const map = Object.create(null);
    for (let n = 0; n < lengths.length; n++) {
      const len = lengths[n];
      if (!len) continue;
      const c = nextCode[len]++;
      let key = "";
      for (let i = len - 1; i >= 0; i--) key += (c >> i) & 1;
      map[key] = n;
    }
    return { max, map };
  }
  function buildFixedLit() {
    const lengths = new Array(288);
    for (let i = 0; i <= 143; i++) lengths[i] = 8;
    for (let i = 144; i <= 255; i++) lengths[i] = 9;
    for (let i = 256; i <= 279; i++) lengths[i] = 7;
    for (let i = 280; i <= 287; i++) lengths[i] = 8;
    return buildHuff(lengths);
  }
  function buildFixedDist() {
    const lengths = new Array(32);
    for (let i = 0; i < 32; i++) lengths[i] = 5;
    return buildHuff(lengths);
  }
  function decodeSym(tree) {
    let key = "";
    for (let i = 0; i < tree.max; i++) {
      key += bits(1);
      if (tree.map[key] !== undefined) return tree.map[key];
    }
    throw new Error("bad huff");
  }
  function copyMatch(len, dist) {
    const start = out.length - dist;
    for (let i = 0; i < len; i++) out.push(out[start + i]);
  }
  let bfinal = 0;
  while (!bfinal) {
    bfinal = bits(1);
    const btype = bits(2);
    if (btype === 0) {
      bitPos = (bitPos + 7) & ~7;
      const bi = bitPos >> 3;
      const len = src[bi] | (src[bi + 1] << 8);
      bitPos = (bi + 4) << 3;
      for (let i = 0; i < len; i++) out.push(src[(bitPos >> 3) + i]);
      bitPos += len * 8;
    } else if (btype === 1 || btype === 2) {
      let lit, dist;
      if (btype === 1) { lit = buildFixedLit(); dist = buildFixedDist(); }
      else {
        const hlit = bits(5) + 257;
        const hdist = bits(5) + 1;
        const hclen = bits(4) + 4;
        const clOrder = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];
        const clen = new Array(19).fill(0);
        for (let i = 0; i < hclen; i++) clen[clOrder[i]] = bits(3);
        const clTree = buildHuff(clen);
        const all = [];
        while (all.length < hlit + hdist) {
          const s = decodeSym(clTree);
          if (s < 16) all.push(s);
          else if (s === 16) {
            const r = bits(2) + 3;
            const prev = all[all.length - 1];
            for (let i = 0; i < r; i++) all.push(prev);
          } else if (s === 17) {
            const r = bits(3) + 3;
            for (let i = 0; i < r; i++) all.push(0);
          } else {
            const r = bits(7) + 11;
            for (let i = 0; i < r; i++) all.push(0);
          }
        }
        lit = buildHuff(all.slice(0, hlit));
        dist = buildHuff(all.slice(hlit));
      }
      for (;;) {
        const s = decodeSym(lit);
        if (s < 256) out.push(s);
        else if (s === 256) break;
        else {
          const idx = s - 257;
          const len = litLenBase[idx] + bits(litLenExtra[idx]);
          const ds = decodeSym(dist);
          const distance = distBase[ds] + bits(distExtra[ds]);
          copyMatch(len, distance);
        }
      }
    } else throw new Error("bad btype");
  }
  return new Uint8Array(out);
}
if (typeof module === "object") module.exports = { inflateZlib };
