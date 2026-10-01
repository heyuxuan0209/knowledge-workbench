import test from 'node:test';
import assert from 'node:assert/strict';
import { ingestYoutube } from './content-ingestion.js';
import { buildYoutubeAudioArgs, selectCaptionLanguageFromMetadata, YOUTUBE_SUB_LANGS } from './asr.js';

const URL = 'https://www.youtube.com/watch?v=7xTGNNLPyMI';
const detail = {
  title: 'Test video',
  channel: 'Test channel',
  publishedAt: '2026-09-30T00:00:00Z',
};

test('YouTube 字幕语言不使用会批量拉自动翻译的通配符', () => {
  assert.equal(YOUTUBE_SUB_LANGS.includes('*'), false);
  assert.match(YOUTUBE_SUB_LANGS, /zh-Hans/);
  assert.match(YOUTUBE_SUB_LANGS, /en/);
});

test('YouTube 只选原语言字幕，不被自动翻译轨拖垮', () => {
  const selected = selectCaptionLanguageFromMetadata({
    language: 'en',
    automatic_captions: {
      'en-orig': [{ name: 'English (Original)' }],
      en: [{ name: 'English' }],
      'zh-Hans': [{ name: 'Chinese (Simplified)' }],
    },
  });
  assert.equal(selected, 'en-orig');
});

test('YouTube language 缺失时仍优先 *-orig 原始轨', () => {
  const selected = selectCaptionLanguageFromMetadata({
    language: null,
    automatic_captions: {
      'zh-Hans': [{ name: 'Chinese (Simplified)' }],
      'en-orig': [{ name: 'English (Original)' }],
    },
  });
  assert.equal(selected, 'en-orig');
});

test('YouTube 优先原语言人工字幕', () => {
  const selected = selectCaptionLanguageFromMetadata({
    language: 'ja',
    subtitles: { ja: [{ name: 'Japanese' }], en: [{ name: 'English' }] },
    automatic_captions: { ja: [{ name: 'Japanese auto' }] },
  });
  assert.equal(selected, 'ja');
});

test('YouTube 无字幕时只下载要分析的低码率音频段', () => {
  const args = buildYoutubeAudioArgs(URL, '/tmp/test-youtube', 2400, true);
  assert.deepEqual(args.slice(0, 2), ['-f', 'bestaudio[abr<=64]/worstaudio/bestaudio']);
  assert.equal(args[args.indexOf('--download-sections') + 1], '*0-2400');
});

test('ffmpeg 不可用时 YouTube 音频仍可退回整段下载', () => {
  const args = buildYoutubeAudioArgs(URL, '/tmp/test-youtube', 2400, false);
  assert.equal(args.includes('--download-sections'), false);
});

test('YouTube 有字幕时不调用 ASR', async () => {
  let transcribeCalls = 0;
  const result = await ingestYoutube(URL, {
    fetchTranscript: async () => [{ text: 'hello', offset: 0, duration: 500 }],
    fetchDetail: async () => detail,
    transcribeVideo: async () => { transcribeCalls += 1; throw new Error('should not run'); },
  });

  assert.equal(result.fetchStatus, 'success');
  assert.equal(result.body, 'hello');
  assert.equal(result.transcriptEngine, 'youtube-transcript');
  assert.equal(result.metadata.author, 'Test channel');
  assert.equal(transcribeCalls, 0);
});

test('YouTube 字幕失败时自动回退到音频 ASR', async () => {
  const result = await ingestYoutube(URL, {
    fetchTranscript: async () => { throw new Error('captions disabled'); },
    fetchDetail: async () => detail,
    transcribeVideo: async () => ({
      text: 'transcribed speech',
      source: 'asr',
      engine: 'groq',
      truncated: false,
      segments: [{ start: 1.25, end: 2.5, text: 'transcribed speech' }],
    }),
  });

  assert.equal(result.fetchStatus, 'success');
  assert.equal(result.body, 'transcribed speech');
  assert.equal(result.transcriptEngine, 'groq');
  assert.match(result.note, /语音转写/);
  assert.deepEqual(result.transcript, [{ text: 'transcribed speech', offset: 1250, duration: 1250 }]);
});

test('ASR 截断时明确标注覆盖时长', async () => {
  const result = await ingestYoutube(URL, {
    fetchTranscript: async () => { throw new Error('no captions'); },
    fetchDetail: async () => detail,
    transcribeVideo: async () => ({
      text: 'partial transcript', source: 'asr', engine: 'local', truncated: true, maxSeconds: 2400,
    }),
  });

  assert.equal(result.fetchStatus, 'success');
  assert.match(result.note, /40 分钟/);
});

test('YouTube 风控时返回可操作的出口诊断', async () => {
  const result = await ingestYoutube(URL, {
    fetchTranscript: async () => { throw new Error('captions unavailable'); },
    fetchDetail: async () => detail,
    transcribeVideo: async () => { throw new Error("Sign in to confirm you're not a bot"); },
  });

  assert.equal(result.fetchStatus, 'failed');
  assert.match(result.fetchError, /反向代理隧道/);
  assert.match(result.fetchError, /人机验证/);
});
