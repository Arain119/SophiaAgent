import iconv from 'iconv-lite'

const MOJIBAKE_MARKERS =
  /[锛鈥瀵缁撴灉鍐冲畾璇佹嵁鍙戠幇鏂囦欢楠岃瘉娴嬭瘯妫鏌鍚庣画涓嬩竴姝闃诲寰呭姙]/g

function textQuality(value: string): number {
  return (
    (value.match(MOJIBAKE_MARKERS)?.length ?? 0) * 3 +
    (value.match(/�/g)?.length ?? 0) * 10
  )
}

/** Repair UTF-8 text decoded as GBK only when the conversion round-trips. */
export function repairMojibake(value: string): string {
  if (!MOJIBAKE_MARKERS.test(value)) return value
  MOJIBAKE_MARKERS.lastIndex = 0
  try {
    const bytes = iconv.encode(value, 'gbk')
    const repaired = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    const roundTrip = iconv.decode(Buffer.from(repaired, 'utf8'), 'gbk')
    return roundTrip === value && textQuality(repaired) < textQuality(value)
      ? repaired
      : value
  } catch {
    return value
  }
}
