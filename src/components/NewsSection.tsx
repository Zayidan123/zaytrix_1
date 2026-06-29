import React, { useState, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  ArrowLeft, 
  Calendar, 
  Clock, 
  User, 
  Share2, 
  Search, 
  TrendingUp, 
  Tag, 
  ChevronRight, 
  ExternalLink,
  BookOpen,
  Filter,
  Bookmark,
  Brain,
  Send,
  ThumbsUp,
  ThumbsDown,
  Activity,
  HelpCircle
} from "lucide-react";

interface NewsArticle {
  id: string;
  title: string;
  summary: string;
  content: string[];
  author: string;
  authorTitle: string;
  date: string;
  readTime: string;
  category: string;
  imageUrl: string;
  source: string;
  subTitle?: string;
  tags: string[];
}

const NEWS_DATA: NewsArticle[] = [
  {
    id: "framework-ventures-400-million",
    title: "Framework Ventures Meluncurkan Dana Keempat Senilai $400 Juta untuk Kripto, AI, dan Robotika",
    subTitle: "Modal ventura Web3 terkemuka ini memperluas mandat investasinya melampaui DeFi tradisional guna menjangkau konvergensi kecerdasan buatan dan sistem mekanis otonom.",
    summary: "Framework Ventures mengumumkan penutupan dana keempat mereka, 'Framework Ventures IV', senilai $400 juta. Dana baru ini akan dialokasikan untuk mendanai startup tahap awal di bidang protokol kripto, kecerdasan buatan (AI), dan teknologi robotika.",
    author: "James Hunt",
    authorTitle: "Senior Ventures Reporter, The Block",
    date: "2026-06-25",
    readTime: "5 min read",
    category: "Venture Capital",
    imageUrl: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1200&q=80",
    source: "The Block",
    tags: ["Venture Capital", "Artificial Intelligence", "Robotics", "Web3", "Framework Ventures"],
    content: [
      "Sektor modal ventura kripto terus menunjukkan tanda-tanda kematangan dan ekspansi horizontal. Hari ini, Framework Ventures, salah satu perusahaan investasi Web3 paling produktif, secara resmi mengumumkan penutupan penggalangan dana terbarunya, 'Framework Ventures IV', dengan total komitmen kapital mencapai $400 juta.",
      "Langkah ambisius ini menandai perluasan yang signifikan dari mandat investasi utama Framework. Meskipun terkenal sebagai investor awal di sektor Keuangan Terdesentralisasi (DeFi) — dengan taruhan sukses di jaringan seperti Synthetix, Chainlink, dan Aave — Framework kini mengarahkan pandangannya pada konvergensi tiga teknologi masa depan yang saling bertumpukan: jaringan kripto terdesentralisasi, kecerdasan buatan konsumen (AI), dan robotika otonom.",
      "Vance Spencer, salah satu pendiri Framework Ventures, menjelaskan keputusan strategis ini dalam sebuah wawancara eksklusif: 'Kami melihat pergeseran paradigma global di mana insentif kriptografi dapat bertindak sebagai lapisan koordinasi utama bagi agen-agen kecerdasan buatan dan armada robot otonom. Masa depan di mana mesin bertransaksi secara on-chain bukan lagi fiksi ilmiah, melainkan sebuah kebutuhan infrastruktur.'",
      "Dana Keempat ini didukung oleh berbagai investor institusional terkemuka, termasuk dana pensiun, universitas (endowment), dan kantor keluarga multi-generasi, yang menegaskan kembalinya kepercayaan institusional terhadap manajer investasi digital berkinerja tinggi pasca siklus konsolidasi pasar sebelumnya.",
      "Alokasi investasi Framework IV diperkirakan akan dibagi menjadi tiga pilar utama:",
      "1. Infrastruktur Web3 & Protokol Kripto (50%): Tetap setia pada akar perusahaan, mendanai protokol skalabilitas, DeFi generasi berikutnya, dan modularitas Web3.",
      "2. AI Terdesentralisasi (30%): Mendukung jaringan komputasi terdistribusi, pasar data kedaulatan, serta agen AI otonom yang menggunakan rel rel kripto untuk berinteraksi secara ekonomi.",
      "3. Sistem Mekanis & Robotika Kripto-Ekonomi (20%): Berinvestasi pada integrasi perangkat keras otonom (hardware), di mana identitas robotik dan integritas rantai pasokan diamankan menggunakan enkripsi kriptografi dan kontrak pintar.",
      "Framework Ventures, didirikan pada tahun 2019 oleh Vance Spencer dan Michael Anderson, saat ini mengelola aset gabungan (AUM) lebih dari $1,4 miliar di seluruh portofolionya. Keberhasilan penutupan dana keempat ini memberikan amunisi baru yang luar biasa besar untuk mendukung para inovator terbaik yang membangun di batas terdepan teknologi komputer."
    ]
  },
  {
    id: "bitcoin-etf-flows-soar-institutional",
    title: "Aliran Masuk ETF Bitcoin Spot Melonjak Saat Investor Institusi Memperluas Kepemilikan Kuartal Ke-2",
    subTitle: "Pengajuan 13F terbaru menunjukkan peningkatan substansial dalam partisipasi institusional, dengan dana pensiun negara dan manajer aset raksasa memimpin pembelian.",
    summary: "ETF Bitcoin Spot mencatat arus masuk mingguan tertinggi sejak Maret, didorong oleh kepatuhan regulasi yang lebih jelas dan alokasi modal dari dana kekayaan negara (sovereign wealth funds).",
    author: "Zack Abrams",
    authorTitle: "Markets Policy Editor, The Block",
    date: "2026-06-24",
    readTime: "4 min read",
    category: "Markets",
    imageUrl: "https://images.unsplash.com/photo-1621761191319-c6fb62004040?auto=format&fit=crop&w=800&q=80",
    source: "The Block",
    tags: ["Bitcoin", "ETF", "Institutional", "BlackRock", "SEC"],
    content: [
      "Arus masuk modal ke dalam ETF Bitcoin Spot sekali lagi memecahkan rekor bulanan. Berdasarkan agregat pelaporan dari kustodian utama di New York, produk investasi Bitcoin terintegrasi ini mencatat arus masuk bersih sebesar $2,1 miliar dalam kurun waktu lima hari perdagangan terakhir saja.",
      "Analisis mendalam terhadap dokumen pelaporan kepemilikan aset kuartalan (Formulir 13F) yang diajukan ke SEC menunjukkan bahwa jenis pembeli ETF telah bergeser secara dramatis dari ritel kaya ke institusi reguler skala penuh. Di antaranya, Dana Pensiun Dewan Negara Bagian Wisconsin dan manajer investasi global Millennium Management memimpin daftar pemegang unit terbesar.",
      "Meskipun volatilitas harga harian BTC tetap ada, tren alokasi jangka panjang menunjukkan bahwa Bitcoin secara resmi telah diadopsi sebagai kelas aset alternatif di mata alokator aset makro. Ini menandai kemenangan struktural yang signifikan bagi ekosistem aset digital global."
    ]
  },
  {
    id: "ethereum-penck-upgrade-announced",
    title: "Developer Ethereum Mengumumkan Tanggal Target Upgrade 'Penck' untuk Meningkatkan Skalabilitas L2",
    subTitle: "Pembaruan konsensus berikutnya akan memperkenalkan kompresi data canggih dan menurunkan biaya gas Layer 2 hingga 90% menggunakan kompresi blob kriptografi.",
    summary: "Upgrade Ethereum berikutnya yang dinamakan 'Penck' dijadwalkan meluncur pada Q3 2026, berfokus penuh pada optimasi transmisi data Blob untuk memotong biaya operasional rollups secara radikal.",
    author: "Christine Kim",
    authorTitle: "Research Director, The Block",
    date: "2026-06-22",
    readTime: "3 min read",
    category: "Technology",
    imageUrl: "https://images.unsplash.com/photo-1622790694515-61759f6b0b30?auto=format&fit=crop&w=800&q=80",
    source: "The Block",
    tags: ["Ethereum", "Layer 2", "Penck", "Scalability", "Gas Fees"],
    content: [
      "Para pengembang inti (core developers) Ethereum secara resmi telah menyepakati jadwal peluncuran untuk peningkatan jaringan besar berikutnya, yang secara internal diberi sandi 'Penck' — dinamai dari penjelajah geologi terkemuka Albrecht Penck.",
      "Fokus utama dari peningkatan ini adalah memperhalus dan memaksimalkan efisiensi struktur 'Blob' (EIP-4844) yang diperkenalkan pada upgrade sebelumnya. Upgrade Penck akan mengimplementasikan skema kompresi data on-chain baru yang secara teoritis mampu melipatgandakan throughput transaksi Layer 2 tanpa membebani ukuran state node validator dasar.",
      "Dengan biaya gas Layer 2 yang diproyeksikan turun hingga serendah sepersepuluh sen dolar per transaksi, upgrade Penck diharapkan mampu memicu gelombang adopsi aplikasi mikro-transaksi, game on-chain, dan agen AI terdesentralisasi secara masif."
    ]
  },
  {
    id: "sec-rules-on-stablecoins-regulatory-clarity",
    title: "DPR AS Meloloskan RUU Regulasi Stablecoin Komprehensif dengan Dukungan Dua Partai",
    subTitle: "Undang-Undang Kepastian Stablecoin 2026 memberikan kerangka kerja federal resmi bagi penerbit stablecoin beragun fiat, memicu reli likuiditas di pasar kripto.",
    summary: "Rancangan undang-undang stablecoin yang lama dinantikan akhirnya disetujui, menetapkan standar cadangan 1 banding 1 yang ketat dan jalur perbankan resmi bagi penerbit yang mematuhi aturan.",
    author: "Sujith Somraaj",
    authorTitle: "Policy & Regulation Specialist, The Block",
    date: "2026-06-20",
    readTime: "4 min read",
    category: "Policy",
    imageUrl: "https://images.unsplash.com/photo-1589829545856-d10d557cf95f?auto=format&fit=crop&w=800&q=80",
    source: "The Block",
    tags: ["Regulation", "Stablecoins", "USDT", "USDC", "Congress"],
    content: [
      "Setelah bertahun-tahun negosiasi sengit di komite keuangan Kongres Amerika Serikat, rancangan undang-undang 'Stablecoin Transparency and Soundness Act of 2026' akhirnya lolos dengan suara mayoritas mutlak dari kedua belah partai politik utama.",
      "RUU baru ini mendefinisikan stablecoin beragun fiat sebagai instrumen pembayaran elektronik resmi di bawah pengawasan bersama Office of the Comptroller of the Currency (OCC) dan Federal Reserve. Penerbit stablecoin sekarang diwajibkan untuk menaruh 100% dari cadangan mereka dalam bentuk surat berharga Treasury jangka pendek dan uang tunai federal yang diaudit secara bulanan oleh auditor independen tier-satu.",
      "Langkah legislatif ini menghilangkan ketidakpastian regulasi yang selama ini menghantui institusi keuangan tradisional, membuka pintu bagi bank investasi global untuk secara legal meluncurkan stablecoin berlabel merk mereka sendiri."
    ]
  },
  {
    id: "solana-validator-emissions-re-examined",
    title: "Proposal Baru Mengusulkan Pembagian Biaya Prioritas Solana 100% ke Validator Guna Mengatasi Spam",
    subTitle: "Langkah kontroversial ini ditujukan untuk memberi insentif tambahan kepada operator node dalam menyaring transaksi spam, namun menghadapi penolakan dari pendukung pembakaran token.",
    summary: "Komunitas Solana memperdebatkan revisi struktur ekonomi biaya prioritas. Proposal SIM-009 mengusulkan penghapusan mekanisme pembakaran 50% biaya prioritas, mengalihkan seluruhnya ke validator.",
    author: "Danny Nelson",
    authorTitle: "DeFi & Layer 1 Lead, The Block",
    date: "2026-06-18",
    readTime: "6 min read",
    category: "DeFi",
    imageUrl: "https://images.unsplash.com/photo-1639762681485-074b7f938ba0?auto=format&fit=crop&w=800&q=80",
    source: "The Block",
    tags: ["Solana", "DeFi", "Validators", "Tokenomics", "Priority Fees"],
    content: [
      "Ketegangan sedang memuncak di forum tata kelola Solana terkait proposal modifikasi tokenomik yang berpotensi mengubah lanskap deflasi jaringan. Proposal tersebut, berkode SIM-009, mengusulkan pengalihan 100% dari biaya prioritas transaksi langsung ke kantong validator yang memproses blok, menggantikan mekanisme pembakaran (burn) 50% saat ini.",
      "Para pendukung proposal berargumen bahwa dengan margin keuntungan validator yang kian menipis akibat tingginya biaya overhead operasional perangkat keras, insentif finansial tambahan mutlak diperlukan guna mengamankan kualitas node serta memotivasi validator dalam memerangi transaksi spam otomatis (bot).",
      "Namun, kritik keras berdatangan dari pemegang token jangka panjang yang khawatir penghapusan mekanisme pembakaran 50% akan melumpuhkan narasi deflasi Solana, dan justru menyebabkan peningkatan emisi pasokan SOL secara neto dari waktu ke waktu."
    ]
  }
];

interface NewsSentimentResult {
  sentiment: "BULLISH" | "BEARISH" | "NEUTRAL";
  score: number;
  summary: string;
  marketImpact: string;
  winners: string[];
  losers: string[];
  shortTermOutlook: string;
  longTermOutlook: string;
  isFallback?: boolean;
}

const getStaticSentiment = (id: string) => {
  if (id === "framework-ventures-400-million") return { label: "BULLISH", score: 92, style: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" };
  if (id === "bitcoin-etf-flows-soar-institutional") return { label: "BULLISH", score: 95, style: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" };
  if (id === "ethereum-penck-upgrade-announced") return { label: "BULLISH", score: 88, style: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" };
  if (id === "sec-rules-on-stablecoins-regulatory-clarity") return { label: "BULLISH", score: 85, style: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" };
  if (id === "solana-validator-emissions-re-examined") return { label: "NEUTRAL", score: 65, style: "bg-amber-500/10 text-amber-400 border-amber-500/20" };
  return { label: "NEUTRAL", score: 70, style: "bg-slate-800 text-slate-400 border-slate-700" };
};

export default function NewsSection() {
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");

  // AI Sentiment States
  const [sentimentLoading, setSentimentLoading] = useState(false);
  const [sentimentResult, setSentimentResult] = useState<NewsSentimentResult | null>(null);
  const [sentimentError, setSentimentError] = useState<string | null>(null);

  // AI Chat States
  const [newsQuestion, setNewsQuestion] = useState("");
  const [newsChatHistory, setNewsChatHistory] = useState<{role: 'user' | 'model', content: string}[]>([]);
  const [chatLoading, setChatLoading] = useState(false);

  useEffect(() => {
    if (!selectedArticleId) {
      setSentimentResult(null);
      setSentimentError(null);
      setNewsChatHistory([]);
      return;
    }
    
    const article = NEWS_DATA.find(art => art.id === selectedArticleId);
    if (!article) return;
    
    setSentimentLoading(true);
    setSentimentResult(null);
    setSentimentError(null);
    
    fetch("/api/gemini/news-sentiment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(article)
    })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        return res.json();
      })
      .then(data => {
        setSentimentResult(data);
      })
      .catch(err => {
        console.error("Failed to load news sentiment", err);
        setSentimentError(err.message || "Gagal memproses sentimen berita.");
      })
      .finally(() => {
        setSentimentLoading(false);
      });
  }, [selectedArticleId]);

  const categories = useMemo(() => {
    const cats = new Set(NEWS_DATA.map(art => art.category));
    return ["All", ...Array.from(cats)];
  }, []);

  const filteredArticles = useMemo(() => {
    return NEWS_DATA.filter(art => {
      const matchesSearch = 
        art.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        art.summary.toLowerCase().includes(searchQuery.toLowerCase()) ||
        art.tags.some(t => t.toLowerCase().includes(searchQuery.toLowerCase()));
      
      const matchesCategory = activeCategory === "All" || art.category === activeCategory;
      return matchesSearch && matchesCategory;
    });
  }, [searchQuery, activeCategory]);

  const featuredArticle = useMemo(() => {
    // Find first article that is Venture Capital or marked as main
    return NEWS_DATA[0];
  }, []);

  const activeArticle = useMemo(() => {
    if (!selectedArticleId) return null;
    return NEWS_DATA.find(art => art.id === selectedArticleId) || null;
  }, [selectedArticleId]);

  // Handle Scroll to top on reading article
  const handleSelectArticle = (id: string) => {
    setSelectedArticleId(id);
    const contentArea = document.getElementById("app-workspace-area");
    if (contentArea) {
      contentArea.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  return (
    <div className="space-y-6 pb-12 text-slate-100" id="news-section-viewport">
      <AnimatePresence mode="wait">
        {!selectedArticleId ? (
          <motion.div
            key="list"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            transition={{ duration: 0.25 }}
            className="space-y-6"
          >
            {/* Header / Search Controls */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800/60 pb-5">
              <div>
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-pulse" />
                  <span className="text-[10px] font-bold text-cyan-400 uppercase tracking-widest font-mono">
                    Global Terminal Feed
                  </span>
                </div>
                <h2 className="text-2xl font-black text-white mt-1 flex items-center gap-2 font-sans">
                  <BookOpen className="w-6 h-6 text-amber-500" />
                  Z-CAPITAL NEWSROOM
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Analisis intelijen pasar langsung dari koresponden global terkemuka kami.
                </p>
              </div>

              <div className="flex items-center gap-2.5 max-w-sm w-full">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Cari berita, emiten, topik..."
                    className="w-full bg-slate-950 border border-slate-800 focus:border-amber-500/50 rounded-lg pl-9 pr-4 py-2 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-amber-500/30 transition-all text-slate-200"
                  />
                </div>
              </div>
            </div>

            {/* Category Tags Filter */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none select-none">
              <Filter className="w-3.5 h-3.5 text-slate-500 shrink-0 mr-1" />
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  className={`text-[10px] uppercase tracking-wider font-bold px-3.5 py-1.5 rounded-full border transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                    activeCategory === cat
                      ? "bg-amber-500/20 text-amber-400 border-amber-500/40 ring-1 ring-amber-500/20"
                      : "bg-slate-950/40 text-slate-400 border-slate-800/60 hover:text-slate-200 hover:border-slate-700"
                  }`}
                >
                  {cat === "All" ? "Semua Berita" : cat}
                </button>
              ))}
            </div>

            {/* Featured Hero Article - Styled like theblock.co top banner */}
            {filteredArticles.length > 0 && activeCategory === "All" && !searchQuery && (
              <div 
                onClick={() => handleSelectArticle(featuredArticle.id)}
                className="group cursor-pointer bg-gradient-to-b from-slate-950/80 to-slate-950 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl transition-all duration-300 hover:border-amber-500/30 ring-1 ring-transparent hover:ring-amber-500/10 flex flex-col lg:flex-row"
              >
                <div className="lg:w-3/5 relative h-64 lg:h-auto overflow-hidden">
                  <img
                    src={featuredArticle.imageUrl}
                    alt={featuredArticle.title}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover group-hover:scale-[1.015] transition-transform duration-500 filter brightness-90 group-hover:brightness-100"
                  />
                  <div className="absolute top-4 left-4 bg-amber-500 text-slate-950 text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded shadow-md font-mono">
                    FEATURED REPORT
                  </div>
                </div>

                <div className="lg:w-2/5 p-6 lg:p-8 flex flex-col justify-between space-y-4">
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] font-bold text-amber-400 uppercase tracking-widest bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                        {featuredArticle.category}
                      </span>
                      {(() => {
                        const sent = getStaticSentiment(featuredArticle.id);
                        return (
                          <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded border ${sent.style}`}>
                            AI: {sent.label} ({sent.score}%)
                          </span>
                        );
                      })()}
                      <span className="text-[10px] text-slate-400 font-mono flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-cyan-500" /> {featuredArticle.readTime}
                      </span>
                    </div>

                    <h3 className="text-xl lg:text-2xl font-black text-white group-hover:text-amber-400 transition-colors tracking-tight leading-tight font-sans">
                      {featuredArticle.title}
                    </h3>
                    
                    <p className="text-xs text-slate-400 leading-relaxed font-medium line-clamp-4">
                      {featuredArticle.summary}
                    </p>
                  </div>

                  <div className="pt-4 border-t border-slate-800 flex items-center justify-between text-slate-500 text-[10px] font-mono">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-slate-800 flex items-center justify-center text-slate-300 font-bold">
                        {featuredArticle.author.charAt(0)}
                      </div>
                      <span className="font-bold text-slate-300">{featuredArticle.author}</span>
                    </div>
                    <span>{featuredArticle.date}</span>
                  </div>
                </div>
              </div>
            )}

            {/* List Grid Feed */}
            {filteredArticles.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredArticles
                  .filter(art => activeCategory !== "All" || searchQuery ? true : art.id !== featuredArticle.id)
                  .map((article) => (
                    <motion.div
                      key={article.id}
                      layout
                      onClick={() => handleSelectArticle(article.id)}
                      className="group cursor-pointer bg-slate-950/40 hover:bg-slate-950/70 border border-slate-800/80 hover:border-slate-700 rounded-xl overflow-hidden shadow-lg transition-all duration-200 flex flex-col justify-between"
                    >
                      <div>
                        {/* Article Image Cover */}
                        <div className="h-44 relative overflow-hidden bg-slate-900">
                          <img
                            src={article.imageUrl}
                            alt={article.title}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300 filter brightness-90 group-hover:brightness-100"
                          />
                          <div className="absolute bottom-3 left-3 bg-slate-950/80 backdrop-blur-md border border-slate-800 text-slate-300 text-[9px] font-mono font-bold px-2 py-0.5 rounded uppercase tracking-wider">
                            {article.source}
                          </div>
                        </div>

                        {/* Article Body */}
                        <div className="p-5 space-y-3">
                          <div className="flex items-center justify-between text-[10px]">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-cyan-400 uppercase tracking-widest font-mono">
                                {article.category}
                              </span>
                              {(() => {
                                const sent = getStaticSentiment(article.id);
                                return (
                                  <span className={`text-[8px] font-mono font-bold px-1.5 py-0.5 rounded border ${sent.style}`}>
                                    {sent.label} ({sent.score}%)
                                  </span>
                                );
                              })()}
                            </div>
                            <span className="text-slate-500 font-mono flex items-center gap-1">
                              <Clock className="w-3 h-3" /> {article.readTime}
                            </span>
                          </div>

                          <h4 className="text-sm font-black text-white group-hover:text-amber-400 transition-colors tracking-tight leading-snug line-clamp-2 font-sans">
                            {article.title}
                          </h4>

                          <p className="text-[11px] text-slate-400 leading-relaxed font-medium line-clamp-3">
                            {article.summary}
                          </p>
                        </div>
                      </div>

                      {/* Article Footer */}
                      <div className="px-5 pb-5 pt-3 border-t border-slate-800/50 flex items-center justify-between text-[10px] font-mono text-slate-500">
                        <span className="font-bold text-slate-400 flex items-center gap-1.5">
                          <User className="w-3 h-3 text-amber-500" /> {article.author}
                        </span>
                        <span>{article.date}</span>
                      </div>
                    </motion.div>
                  ))}
              </div>
            ) : (
              <div className="bg-slate-950/30 border border-slate-800/60 rounded-xl p-12 text-center text-slate-500">
                <Search className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                <p className="text-sm font-bold text-slate-400">Tidak ada artikel yang cocok</p>
                <p className="text-xs text-slate-500 mt-1">Coba sesuaikan kata kunci pencarian atau kategori filter Anda.</p>
              </div>
            )}
          </motion.div>
        ) : (
          /* Detailed Premium Article View - modeled after theblock.co/post/... */
          <motion.div
            key="article-detail"
            initial={{ opacity: 0, scale: 0.99 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.99 }}
            transition={{ duration: 0.25 }}
            className="max-w-4xl mx-auto space-y-8"
          >
            {/* Navigation back button */}
            <div className="flex items-center justify-between border-b border-slate-800/60 pb-4">
              <button
                onClick={() => setSelectedArticleId(null)}
                className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-400 hover:text-white bg-slate-900 border border-slate-800 px-3.5 py-1.5 rounded-lg transition-colors cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                Kembali ke Newsroom
              </button>

              <div className="flex items-center gap-2">
                <button 
                  onClick={() => alert("Tautan artikel disalin ke papan klip!")}
                  className="p-2 bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-400 hover:text-white rounded-lg transition-colors cursor-pointer"
                  title="Bagikan Artikel"
                >
                  <Share2 className="w-4 h-4" />
                </button>
                <button 
                  className="p-2 bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-400 hover:text-white rounded-lg transition-colors cursor-pointer"
                  title="Simpan Artikel"
                >
                  <Bookmark className="w-4 h-4" />
                </button>
              </div>
            </div>

            {activeArticle && (
              <article className="space-y-6">
                {/* Meta Metadata Header */}
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-black text-amber-400 uppercase tracking-widest font-mono bg-amber-500/10 px-2.5 py-1 rounded border border-amber-500/20 shadow-sm">
                      {activeArticle.category}
                    </span>
                    <span className="text-slate-500 font-mono">•</span>
                    <span className="text-slate-400 font-mono flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5 text-cyan-500" /> {activeArticle.date}
                    </span>
                    <span className="text-slate-500 font-mono">•</span>
                    <span className="text-slate-400 font-mono flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5 text-cyan-500" /> {activeArticle.readTime} membaca
                    </span>
                  </div>

                  <h1 className="text-2xl md:text-4xl font-black text-white tracking-tight leading-tight font-sans">
                    {activeArticle.title}
                  </h1>

                  {activeArticle.subTitle && (
                    <p className="text-sm md:text-base text-slate-400 leading-relaxed font-semibold border-l-2 border-amber-500 pl-4 py-1">
                      {activeArticle.subTitle}
                    </p>
                  )}
                </div>

                {/* Author Information Badge */}
                <div className="flex items-center gap-3 bg-slate-950/60 border border-slate-800/60 p-4 rounded-xl">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-amber-500 to-amber-600 flex items-center justify-center text-slate-950 font-black shrink-0 shadow-md">
                    {activeArticle.author.charAt(0)}
                  </div>
                  <div>
                    <h5 className="text-xs font-black text-slate-200">{activeArticle.author}</h5>
                    <p className="text-[10px] text-slate-500 font-mono">{activeArticle.authorTitle}</p>
                  </div>
                </div>

                {/* Hero Featured Image */}
                <div className="relative rounded-2xl overflow-hidden border border-slate-800 shadow-2xl h-64 md:h-[400px]">
                  <img
                    src={activeArticle.imageUrl}
                    alt={activeArticle.title}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-transparent opacity-60" />
                </div>

                {/* Editorial Body Content - styled beautifully for deep layout */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 pt-4">
                  {/* Left Sidebar Table of Content / Stats */}
                  <div className="lg:col-span-3 space-y-5 hidden lg:block">
                    <div className="sticky top-6 space-y-4">
                      <div className="bg-slate-950/80 border border-slate-800 p-4 rounded-xl space-y-3.5">
                        <span className="text-[10px] font-bold text-cyan-400 uppercase tracking-widest block font-mono">
                          ANALYSIS OUTLINE
                        </span>
                        <div className="space-y-2 text-[11px] font-semibold text-slate-400">
                          <div className="flex items-center gap-2 text-amber-400 border-l-2 border-amber-500 pl-2">
                            <span>Laporan Utama</span>
                          </div>
                          <div className="hover:text-slate-200 pl-2.5 transition-colors cursor-pointer">
                            <span>Konteks Industri</span>
                          </div>
                          <div className="hover:text-slate-200 pl-2.5 transition-colors cursor-pointer">
                            <span>Dampak Pasar</span>
                          </div>
                        </div>
                      </div>

                      <div className="bg-slate-950/80 border border-slate-800 p-4 rounded-xl space-y-3">
                        <span className="text-[10px] font-bold text-cyan-400 uppercase tracking-widest block font-mono">
                          ASET TERKAIT
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {activeArticle.tags.slice(0, 3).map(tag => (
                            <span key={tag} className="bg-slate-900 border border-slate-800 text-[9px] font-mono font-bold text-slate-400 px-2 py-1 rounded">
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Right Article Body Text Content - theblock.co layout style */}
                  <div className="lg:col-span-9 space-y-5 leading-relaxed text-sm text-slate-300 font-medium font-sans">
                    
                    {/* 🧠 AI SENTIMENT & INTELIJEN PASAR CARD */}
                    <div className="bg-slate-950/80 border border-slate-800 rounded-xl overflow-hidden p-6 mb-6 space-y-5 shadow-xl relative">
                      {/* Header with Sparkles & Live badge */}
                      <div className="flex items-center justify-between border-b border-slate-800/60 pb-3">
                        <div className="flex items-center gap-2">
                          <div className="p-1.5 bg-amber-500/15 rounded-lg text-amber-400">
                            <Brain className="w-5 h-5" />
                          </div>
                          <div>
                            <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                              ANALISIS SENTIMEN AI
                              <span className="text-[9px] bg-cyan-500/10 text-cyan-400 px-2 py-0.5 rounded font-mono border border-cyan-500/20 uppercase tracking-wider">
                                GEMINI 3.5 LIVE
                              </span>
                            </h3>
                            <p className="text-[10px] text-slate-400 font-mono">Market Intel & Sentiment Analyzer</p>
                          </div>
                        </div>
                        
                        {sentimentResult?.isFallback && (
                          <span className="text-[8px] bg-slate-900 border border-slate-800 text-slate-400 px-2 py-0.5 rounded font-mono uppercase">
                            OFFLINE INDEX ACTIVE
                          </span>
                        )}
                      </div>

                      {sentimentLoading ? (
                        <div className="py-8 text-center space-y-3">
                          <div className="relative w-12 h-12 mx-auto">
                            <div className="absolute inset-0 rounded-full border-2 border-amber-500/20" />
                            <div className="absolute inset-0 rounded-full border-2 border-t-amber-500 animate-spin" />
                          </div>
                          <div className="space-y-1">
                            <p className="text-xs text-slate-300 font-black animate-pulse">Menghubungi AI Z-Capital...</p>
                            <p className="text-[10px] text-slate-500">Mengekstrak korelasi makro & sentimen tokenomik</p>
                          </div>
                        </div>
                      ) : sentimentError ? (
                        <div className="bg-red-500/5 border border-red-500/15 p-4 rounded-xl text-center space-y-2">
                          <p className="text-xs text-red-400 font-bold">{sentimentError}</p>
                          <button 
                            onClick={() => {
                              setSelectedArticleId(null);
                              setTimeout(() => setSelectedArticleId(activeArticle?.id || null), 10);
                            }}
                            className="text-[10px] bg-red-500/15 text-red-300 border border-red-500/20 px-3 py-1 rounded cursor-pointer hover:bg-red-500/25 transition-all font-bold"
                          >
                            Coba Lagi
                          </button>
                        </div>
                      ) : sentimentResult ? (
                        <div className="space-y-4">
                          {/* Sentiment Gauge & Info */}
                          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
                            {/* Sentiment Gauge Column */}
                            <div className="md:col-span-4 flex flex-col items-center justify-center text-center bg-slate-900/50 border border-slate-800/60 p-4 rounded-xl relative overflow-hidden">
                              {/* Subtle background glow based on sentiment */}
                              <div className={`absolute -bottom-10 -left-10 w-24 h-24 rounded-full filter blur-2xl opacity-10 ${
                                sentimentResult.sentiment === "BULLISH" ? "bg-emerald-500" :
                                sentimentResult.sentiment === "BEARISH" ? "bg-rose-500" : "bg-amber-500"
                              }`} />
                              
                              <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest font-mono mb-1">SENTIMEN UTAMA</span>
                              <div className={`text-sm md:text-base font-black tracking-tight flex items-center gap-1.5 ${
                                sentimentResult.sentiment === "BULLISH" ? "text-emerald-400" :
                                sentimentResult.sentiment === "BEARISH" ? "text-rose-400" : "text-amber-400"
                              }`}>
                                {sentimentResult.sentiment === "BULLISH" && <ThumbsUp className="w-4 h-4 text-emerald-400 shrink-0" />}
                                {sentimentResult.sentiment === "BEARISH" && <ThumbsDown className="w-4 h-4 text-rose-400 shrink-0" />}
                                {sentimentResult.sentiment === "NEUTRAL" && <Activity className="w-4 h-4 text-amber-400 shrink-0" />}
                                {sentimentResult.sentiment}
                              </div>
                              <div className="text-[10px] text-slate-400 font-mono mt-1">
                                Skor Keyakinan: <span className="font-bold text-white">{sentimentResult.score}%</span>
                              </div>
                              {/* Progress Bar Gauge */}
                              <div className="w-full bg-slate-950 border border-slate-800/80 rounded-full h-1.5 mt-2 overflow-hidden">
                                <div 
                                  className={`h-full rounded-full transition-all duration-1000 ${
                                    sentimentResult.sentiment === "BULLISH" ? "bg-emerald-500" :
                                    sentimentResult.sentiment === "BEARISH" ? "bg-rose-500" : "bg-amber-500"
                                  }`}
                                  style={{ width: `${sentimentResult.score}%` }}
                                />
                              </div>
                            </div>

                            {/* Executive summary Column */}
                            <div className="md:col-span-8 space-y-1.5">
                              <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest font-mono">IKHTISAR ANALIS (CFA REPORT)</span>
                              <p className="text-xs text-slate-200 leading-relaxed font-semibold">
                                {sentimentResult.summary}
                              </p>
                            </div>
                          </div>

                          {/* Impact Breakdown */}
                          <div className="bg-slate-900/40 border border-slate-800/40 p-4 rounded-xl space-y-3">
                            <div className="space-y-1">
                              <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest font-mono block">DAMPAK PASAR & EKOSISTEM</span>
                              <p className="text-xs text-slate-300 leading-relaxed font-medium">{sentimentResult.marketImpact}</p>
                            </div>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-slate-800/40">
                              <div className="space-y-1.5">
                                <div className="flex items-center gap-1">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                  <span className="text-[9px] font-bold text-emerald-400 uppercase tracking-widest font-mono">POTENSI PEMENANG (WINNERS)</span>
                                </div>
                                <div className="flex flex-wrap gap-1">
                                  {sentimentResult.winners.map(w => (
                                    <span key={w} className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-[10px] px-2 py-0.5 rounded font-bold font-sans">
                                      {w}
                                    </span>
                                  ))}
                                </div>
                              </div>
                              
                              <div className="space-y-1.5">
                                <div className="flex items-center gap-1">
                                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                                  <span className="text-[9px] font-bold text-rose-400 uppercase tracking-widest font-mono">POTENSI RISIKO (LOSERS)</span>
                                </div>
                                <div className="flex flex-wrap gap-1">
                                  {sentimentResult.losers.map(l => (
                                    <span key={l} className="bg-rose-500/10 border border-rose-500/20 text-rose-300 text-[10px] px-2 py-0.5 rounded font-bold font-sans">
                                      {l}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Short & Long Term Outlook */}
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="bg-slate-900/30 border border-slate-800/40 p-4 rounded-xl space-y-1">
                              <span className="text-[9px] font-bold text-cyan-400 uppercase tracking-widest font-mono block">PROSPEK JANGKA PENDEK (1-7 HARI)</span>
                              <p className="text-[11px] text-slate-400 leading-relaxed font-medium">{sentimentResult.shortTermOutlook}</p>
                            </div>
                            <div className="bg-slate-900/30 border border-slate-800/40 p-4 rounded-xl space-y-1">
                              <span className="text-[9px] font-bold text-purple-400 uppercase tracking-widest font-mono block">PROSPEK STRUKTURAL JANGKA PANJANG</span>
                              <p className="text-[11px] text-slate-400 leading-relaxed font-medium">{sentimentResult.longTermOutlook}</p>
                            </div>
                          </div>

                          {/* 💬 INTERACTIVE CHAT WITH AI SECTION */}
                          <div className="border-t border-slate-800/80 pt-4 space-y-3">
                            <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest font-mono flex items-center gap-1">
                              <HelpCircle className="w-3.5 h-3.5 text-amber-500" /> TANYA ASISTEN AI TENTANG BERITA INI
                            </span>
                            
                            {/* Chat message list */}
                            {newsChatHistory.length > 0 && (
                              <div className="space-y-3 max-h-48 overflow-y-auto p-3 bg-slate-950/60 border border-slate-800/60 rounded-xl scrollbar-thin">
                                {newsChatHistory.map((chat, idx) => (
                                  <div 
                                    key={idx} 
                                    className={`flex gap-2.5 ${chat.role === 'user' ? 'justify-end' : 'justify-start'}`}
                                  >
                                    {chat.role !== 'user' && (
                                      <div className="w-5 h-5 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center shrink-0">
                                        <Brain className="w-3 h-3 text-amber-400" />
                                      </div>
                                    )}
                                    <div className={`p-2.5 rounded-xl max-w-[85%] text-xs leading-relaxed ${
                                      chat.role === 'user' 
                                        ? 'bg-amber-500/15 border border-amber-500/20 text-slate-200 rounded-tr-none' 
                                        : 'bg-slate-900 border border-slate-800/80 text-slate-300 rounded-tl-none'
                                    }`}>
                                      {chat.content}
                                    </div>
                                  </div>
                                ))}
                                
                                {chatLoading && (
                                  <div className="flex gap-2.5 justify-start">
                                    <div className="w-5 h-5 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center shrink-0">
                                      <Brain className="w-3 h-3 text-amber-400 animate-pulse" />
                                    </div>
                                    <div className="bg-slate-900 border border-slate-800/80 p-2.5 rounded-xl rounded-tl-none text-xs text-slate-500 font-mono animate-pulse">
                                      AI sedang merumuskan jawaban...
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Input area */}
                            <form 
                              onSubmit={(e) => {
                                e.preventDefault();
                                if (!newsQuestion.trim() || chatLoading) return;
                                
                                const question = newsQuestion.trim();
                                setNewsQuestion("");
                                const userMsg = { role: 'user' as const, content: question };
                                setNewsChatHistory(prev => [...prev, userMsg]);
                                setChatLoading(true);

                                fetch("/api/gemini/news-chat", {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({
                                    article: activeArticle,
                                    question,
                                    chatHistory: [...newsChatHistory, userMsg]
                                  })
                                })
                                  .then(res => {
                                    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
                                    return res.json();
                                  })
                                  .then(data => {
                                    setNewsChatHistory(prev => [...prev, { role: 'model', content: data.answer }]);
                                  })
                                  .catch(err => {
                                    setNewsChatHistory(prev => [...prev, { 
                                      role: 'model', 
                                      content: `Maaf, asisten AI mendeteksi gangguan jaringan: ${err.message || String(err)}. Silakan coba tanyakan kembali.` 
                                    }]);
                                  })
                                  .finally(() => {
                                    setChatLoading(false);
                                  });
                              }}
                              className="flex items-center gap-2"
                            >
                              <input
                                type="text"
                                value={newsQuestion}
                                onChange={(e) => setNewsQuestion(e.target.value)}
                                disabled={chatLoading}
                                placeholder="Tanyakan dampak berita ini... (misal: 'Berapa persen alokasi aset ideal?')"
                                className="flex-1 bg-slate-950 border border-slate-800 focus:border-amber-500/50 rounded-lg px-3 py-2 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-amber-500/30 text-slate-200 disabled:opacity-50"
                              />
                              <button
                                type="submit"
                                disabled={!newsQuestion.trim() || chatLoading}
                                className="bg-amber-500 hover:bg-amber-600 disabled:bg-slate-800 disabled:opacity-40 text-slate-950 p-2 rounded-lg cursor-pointer transition-all shrink-0 flex items-center justify-center border-none"
                              >
                                <Send className="w-3.5 h-3.5 text-slate-950" />
                              </button>
                            </form>

                            {/* Suggestion tags if chat is empty */}
                            {newsChatHistory.length === 0 && (
                              <div className="flex flex-wrap gap-2 pt-1">
                                <span className="text-[9px] text-slate-500 font-mono flex items-center">Rekomendasi Pertanyaan:</span>
                                <button 
                                  type="button"
                                  onClick={() => setNewsQuestion("Bagaimana alokasi portofolio terbaik merespon berita ini?")}
                                  className="text-[9px] font-mono bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-400 hover:text-slate-200 px-2 py-1 rounded cursor-pointer transition-all"
                                >
                                  "Alokasi portofolio terbaik?"
                                </button>
                                <button 
                                  type="button"
                                  onClick={() => setNewsQuestion("Apa saja risiko tersembunyi yang belum dibahas berita ini?")}
                                  className="text-[9px] font-mono bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-400 hover:text-slate-200 px-2 py-1 rounded cursor-pointer transition-all"
                                >
                                  "Risiko tersembunyi?"
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      ) : null}
                    </div>

                    {activeArticle.content.map((paragraph, index) => {
                      // Turn headings into bold display items if starts with number
                      if (paragraph.match(/^\d+\./)) {
                        return (
                          <h4 key={index} className="text-base font-black text-white pt-4 tracking-tight flex items-center gap-2">
                            <span className="text-amber-500 font-mono">{paragraph.substring(0, 2)}</span>
                            <span>{paragraph.substring(2)}</span>
                          </h4>
                        );
                      }
                      
                      // Highlight blockquotes
                      if (paragraph.includes("Vance Spencer") && paragraph.includes(":")) {
                        const [speaker, speech] = paragraph.split(":");
                        return (
                          <div key={index} className="bg-gradient-to-r from-slate-950 to-slate-900 border-l-4 border-amber-500 p-5 rounded-r-xl my-6 relative overflow-hidden font-sans">
                            <span className="text-5xl text-amber-500/15 absolute right-4 top-1 select-none pointer-events-none">“</span>
                            <p className="italic text-slate-200 text-sm leading-relaxed relative z-10 font-semibold">
                              {speech}
                            </p>
                            <p className="text-right text-[10px] font-bold uppercase tracking-wider text-amber-500 mt-2 font-mono">
                              — {speaker}
                            </p>
                          </div>
                        );
                      }

                      return (
                        <p key={index} className="leading-relaxed text-[13px] md:text-sm text-slate-300">
                          {paragraph}
                        </p>
                      );
                    })}

                    {/* Tag Cloud */}
                    <div className="pt-6 border-t border-slate-800 flex flex-wrap items-center gap-2">
                      <Tag className="w-3.5 h-3.5 text-slate-500" />
                      <span className="text-[10px] text-slate-500 font-bold font-mono mr-1.5">TAGS:</span>
                      {activeArticle.tags.map(tag => (
                        <span key={tag} className="bg-slate-900 border border-slate-800 text-[10px] font-mono text-slate-400 px-2.5 py-1 rounded-full">
                          #{tag}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Bottom Disclaimer */}
                <div className="bg-slate-950/40 border border-slate-800/60 p-5 rounded-xl text-[10px] text-slate-500 leading-relaxed font-mono mt-8">
                  <span className="font-bold text-slate-400 block mb-1">Pemberitahuan Kepatuhan Hukum & Risiko (Disclaimer):</span>
                  Informasi di atas bersumber dari data publik dan analisis independen, disediakan murni sebagai bentuk intelijen berita pasar terdesentralisasi oleh Z-Capital Global Gateway. Laporan ini tidak mengandung dan tidak boleh ditafsirkan sebagai rekomendasi sekuritas formal, anjuran beli/jual aset kripto, atau nasihat investasi berlisensi lainnya.
                </div>

                {/* Related Articles Suggestions Footer */}
                <div className="pt-8 border-t border-slate-800 space-y-4">
                  <h4 className="text-xs font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-cyan-400" /> RELATED INVESTIGATION REPORTS
                  </h4>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {NEWS_DATA
                      .filter(art => art.id !== activeArticle.id)
                      .slice(0, 2)
                      .map(art => (
                        <div
                          key={art.id}
                          onClick={() => handleSelectArticle(art.id)}
                          className="bg-slate-950/40 hover:bg-slate-950/70 border border-slate-800 p-4 rounded-xl cursor-pointer transition-all duration-200 flex gap-4 items-center group"
                        >
                          <div className="w-16 h-16 rounded-lg overflow-hidden shrink-0 bg-slate-900">
                            <img
                              src={art.imageUrl}
                              alt={art.title}
                              referrerPolicy="no-referrer"
                              className="w-full h-full object-cover filter brightness-90 group-hover:brightness-100"
                            />
                          </div>
                          <div className="space-y-1 overflow-hidden">
                            <span className="text-[9px] font-bold text-amber-500 font-mono uppercase">
                              {art.category}
                            </span>
                            <h5 className="text-xs font-black text-white group-hover:text-amber-400 transition-colors line-clamp-2 leading-snug">
                              {art.title}
                            </h5>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              </article>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
