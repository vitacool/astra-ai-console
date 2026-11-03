import { describe, expect, it } from 'vitest';
import { chunkDocument } from './lib/chunking.js';
import { localHashEmbedding } from './lib/embeddings.js';
import { extractTerms, lexicalScore } from './lib/lexical.js';
import { cosineSimilarity } from './vector/types.js';

describe('RAG primitives', () => {
  it('chunks markdown by headings and respects the size budget', () => {
    const paragraph =
      '平台默认对模型密钥进行 AES-256-GCM 加密，所有对话按工作区隔离。'.repeat(30);
    const chunks = chunkDocument(
      '安全白皮书',
      `# 数据安全\n\n${paragraph}\n\n## 密钥管理\n\n${paragraph}`,
    );
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks[0].title).toContain('安全白皮书');
    expect(chunks[0].title).toContain('数据安全');
    expect(chunks.some((chunk) => chunk.title.includes('密钥管理'))).toBe(true);
    expect(chunks.every((chunk) => chunk.content.length <= 1000)).toBe(true);
    expect(chunks.every((chunk) => chunk.tokens > 0)).toBe(true);
  });

  it('produces deterministic, normalized local vectors', () => {
    const a = localHashEmbedding('企业版如何保护 API Key 和数据安全', 1536);
    const b = localHashEmbedding('企业版如何保护 API Key 和数据安全', 1536);
    const c = localHashEmbedding('今天的天气和午餐吃什么', 1536);
    expect(a).toHaveLength(1536);
    expect(a).toEqual(b);
    expect(cosineSimilarity(a, a)).toBeCloseTo(1, 4);
    expect(cosineSimilarity(a, c)).toBeLessThan(cosineSimilarity(a, b));
    const norm = Math.sqrt(a.reduce((sum, value) => sum + value * value, 0));
    expect(norm).toBeCloseTo(1, 4);
  });

  it('extracts useful terms and scores exact evidence higher', () => {
    const terms = extractTerms('企业版如何保障 API Key 和数据安全？');
    expect(terms).toContain('api');
    expect(terms).toContain('key');
    expect(terms).toContain('安全');
    expect(terms).not.toContain('如何');

    const relevant = lexicalScore(
      '平台默认对模型密钥进行加密，并保障工作区数据安全。',
      terms,
      '数据安全',
    );
    const irrelevant = lexicalScore(
      '今天的天气很好，午餐吃牛肉面。',
      terms,
      '数据安全',
    );
    expect(relevant).toBeGreaterThan(irrelevant);
    expect(relevant).toBeGreaterThan(0.2);
  });
});
