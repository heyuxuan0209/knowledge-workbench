// 上传文件名的编码回正。
//
// multer 底下的 busboy 按 latin1 解 multipart 的 filename，所以中文文件名到手里是双重编码：
//   「飞书demo day5」→「é£ä¹¦demo day5」
// 后果不只是难看——source_title 会被拼进 embedding 文本（semantic-search 的 noteText），
// 等于这条素材的来源信息对检索完全失效。实测踩到 4 条，全是录音/PDF 上传的一手材料。
//
// 关键：**不能无脑转**。转换只在「转完确实变成合法中文」时才采用——
//   · ASCII 文件名转了等于没转，无所谓；
//   · 但哪天 busboy 改了行为、或客户端本来就发的是正确 UTF-8，再转一次会把好名字搞坏。
// 所以判据是：转换后必须含 CJK、且不含替换字符 U+FFFD，否则原样返回。

const CJK = /[一-龥぀-ヿ가-힯]/;

export function decodeUploadFilename(name) {
  if (!name || typeof name !== 'string') return name;
  if (CJK.test(name)) return name;                 // 已经是好的中文，别再动它
  try {
    const decoded = Buffer.from(name, 'latin1').toString('utf8');
    if (decoded !== name && CJK.test(decoded) && !decoded.includes('�')) return decoded;
  } catch { /* 转不了就当它本来就是对的 */ }
  return name;
}
