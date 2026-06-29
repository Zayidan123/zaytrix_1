'use client';

import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'shall', 'can', 'this', 'that',
  'these', 'those', 'it', 'its', 'i', 'we', 'you', 'he', 'she', 'they',
  'them', 'their', 'our', 'my', 'your', 'his', 'her', 'as', 'if', 'not',
  'no', 'so', 'than', 'then', 'also', 'just', 'about', 'up', 'out',
  'which', 'what', 'when', 'where', 'who', 'how', 'all', 'each', 'every',
  'both', 'few', 'more', 'most', 'other', 'some', 'such', 'only', 'own',
  'same', 'into', 'over', 'after', 'before', 'between', 'through',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

function wordFrequency(words: string[]): { word: string; count: number }[] {
  const freq: Record<string, number> = {};
  for (const w of words) freq[w] = (freq[w] ?? 0) + 1;
  return Object.entries(freq)
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  const intersection = new Set(Array.from(a).filter((x) => b.has(x)));
  const union = new Set([...Array.from(a), ...Array.from(b)]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

interface CompareResult {
  similarity: number;
  freq1: { word: string; count: number }[];
  freq2: { word: string; count: number }[];
  commonWords: string[];
}

const DEFAULT_DOC_1 = `Bitcoin is the first decentralized cryptocurrency created in 2009 by Satoshi Nakamoto. It uses a proof-of-work consensus mechanism and has a fixed supply of 21 million coins. Bitcoin transactions are verified by network nodes through cryptography and recorded on a public blockchain.`;
const DEFAULT_DOC_2 = `Ethereum is a decentralized blockchain platform that enables smart contracts and decentralized applications. Created by Vitalik Buterin in 2015, it uses proof-of-stake consensus. Ethereum transactions are verified by validators and recorded on a distributed ledger. The platform supports programmable money and token creation.`;

export default function AIDocCompare() {
  const [doc1, setDoc1] = useState(DEFAULT_DOC_1);
  const [doc2, setDoc2] = useState(DEFAULT_DOC_2);
  const [result, setResult] = useState<CompareResult | null>(null);

  const handleCompare = () => {
    const words1 = tokenize(doc1);
    const words2 = tokenize(doc2);
    const set1 = new Set(words1);
    const set2 = new Set(words2);
    const similarity = jaccard(set1, set2);
    const commonWords = Array.from(set1).filter((w) => set2.has(w)).sort();
    setResult({
      similarity,
      freq1: wordFrequency(words1).slice(0, 10),
      freq2: wordFrequency(words2).slice(0, 10),
      commonWords,
    });
  };

  const matrixData = useMemo(() => {
    if (!result) return null;
    const allWords = Array.from(
      new Set([...result.freq1.map((f) => f.word), ...result.freq2.map((f) => f.word)])
    ).slice(0, 12);
    const map1 = Object.fromEntries(result.freq1.map((f) => [f.word, f.count]));
    const map2 = Object.fromEntries(result.freq2.map((f) => [f.word, f.count]));
    return allWords.map((word) => ({
      word,
      inDoc1: map1[word] ?? 0,
      inDoc2: map2[word] ?? 0,
      isCommon: !!map1[word] && !!map2[word],
    }));
  }, [result]);

  return (
    <div className="space-y-8 animate-fade-in-up">
      <div>
        <h1 className="text-4xl font-bold gradient-text-3">Document Compare</h1>
        <p className="text-muted-foreground mt-1">Analyze similarity and word patterns between two documents</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="glass-card-3d p-5 space-y-3">
          <Label className="text-muted-foreground text-sm">Document A</Label>
          <Textarea
            value={doc1}
            onChange={(e) => setDoc1(e.target.value)}
            rows={10}
            className="bg-transparent border-white/10 text-foreground resize-none"
            placeholder="Paste first document here..."
          />
        </div>
        <div className="glass-card-3d p-5 space-y-3">
          <Label className="text-muted-foreground text-sm">Document B</Label>
          <Textarea
            value={doc2}
            onChange={(e) => setDoc2(e.target.value)}
            rows={10}
            className="bg-transparent border-white/10 text-foreground resize-none"
            placeholder="Paste second document here..."
          />
        </div>
      </div>

      <Button
        onClick={handleCompare}
        size="lg"
        className="gradient-bg-3 text-foreground font-bold"
      >
        Compare Documents
      </Button>

      {result && (
        <div className="space-y-6 stagger-children animate-fade-in-up">
          <Separator className="opacity-20" />

          <div className="glass-card-3d p-8 flex flex-col items-center text-center">
            <p className="text-muted-foreground text-sm uppercase tracking-wider mb-2">Jaccard Similarity</p>
            <p className="text-foreground text-7xl font-bold tabular-nums">
              {(result.similarity * 100).toFixed(1)}%
            </p>
            <div className="w-full max-w-md h-3 rounded-full bg-white/5 mt-4 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-1000"
                style={{
                  width: `${result.similarity * 100}%`,
                  background: 'linear-gradient(90deg, #f59e0b, #facc15)',
                }}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className="glass-card-3d p-5">
              <p className="text-foreground text-sm font-semibold mb-3">Top Words — Doc A</p>
              <div className="space-y-2">
                {result.freq1.map((f) => (
                  <div key={f.word} className="flex items-center justify-between text-sm">
                    <span className="text-foreground">{f.word}</span>
                    <span className="text-muted-foreground tabular-nums">{f.count}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="glass-card-3d p-5 overflow-x-auto">
              <p className="text-foreground text-sm font-semibold mb-3">Comparison Matrix</p>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left text-muted-foreground font-medium pb-2">Word</th>
                    <th className="text-center text-muted-foreground font-medium pb-2">Doc A</th>
                    <th className="text-center text-muted-foreground font-medium pb-2">Doc B</th>
                  </tr>
                </thead>
                <tbody>
                  {matrixData?.map((row) => (
                    <tr
                      key={row.word}
                      className={`border-b border-white/5 last:border-0 ${row.isCommon ? 'bg-amber-500/5' : ''}`}
                    >
                      <td className={`py-1.5 pr-2 font-medium ${row.isCommon ? 'text-amber-400' : 'text-foreground'}`}>
                        {row.isCommon && <span className="mr-1">●</span>}
                        {row.word}
                      </td>
                      <td className="text-center py-1.5 tabular-nums text-foreground">{row.inDoc1 || '—'}</td>
                      <td className="text-center py-1.5 tabular-nums text-foreground">{row.inDoc2 || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {result.commonWords.length > 0 && (
                <p className="text-[10px] text-muted-foreground mt-3">
                  <span className="inline-block w-2 h-2 rounded-full bg-amber-400 mr-1" />
                  Highlighted rows = words shared in both documents
                </p>
              )}
            </div>

            <div className="glass-card-3d p-5">
              <p className="text-foreground text-sm font-semibold mb-3">Top Words — Doc B</p>
              <div className="space-y-2">
                {result.freq2.map((f) => (
                  <div key={f.word} className="flex items-center justify-between text-sm">
                    <span className="text-foreground">{f.word}</span>
                    <span className="text-muted-foreground tabular-nums">{f.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
