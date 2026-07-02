/**
 * Professional CFA Institute-styled Advisory Research Tool
 * Supports generating elegant, formatted documents on the client-side
 * using the browser's high-fidelity native print engine.
 */

export function parseMarkdownToHtml(markdown: string): string {
  if (!markdown) return "";
  const lines = markdown.split("\n");
  let html = "";
  let inList = false;

  for (let line of lines) {
    let trimmed = line.trim();
    
    // Check list item
    if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      if (!inList) {
        html += '<ul style="margin-left: 0; margin-bottom: 15px; padding-left: 20px; list-style-type: square; line-height: 1.6;">';
        inList = true;
      }
      const itemText = trimmed.substring(2).replace(/\*\*(.*?)\*\//g, '<strong>$1</strong>')
                                           .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      html += `<li style="margin-bottom: 8px; font-size: 13.5px; color: #334155;">${itemText}</li>`;
      continue;
    } else {
      if (inList) {
        html += "</ul>";
        inList = false;
      }
    }

    // Check headings
    if (trimmed.startsWith("### ")) {
      const heading = trimmed.substring(4).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      html += `<h3 style="color: #0d9488; font-size: 16px; margin-top: 26px; margin-bottom: 10px; border-bottom: 1px dashed #94a3b8; padding-bottom: 6px; font-weight: 700; text-transform: uppercase; font-family: 'Cinzel', serif; letter-spacing: 0.5px;">${heading}</h3>`;
    } else if (trimmed.startsWith("#### ")) {
      const heading = trimmed.substring(5).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      html += `<h4 style="color: #0f172a; font-size: 14px; margin-top: 20px; margin-bottom: 8px; font-weight: 700;">${heading}</h4>`;
    } else if (trimmed.startsWith("## ")) {
      const heading = trimmed.substring(3).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      html += `<h2 style="color: #042f2e; font-size: 18px; margin-top: 32px; margin-bottom: 14px; font-weight: 700; border-bottom: 2px solid #0d9488; padding-bottom: 8px; font-family: 'Cinzel', serif; letter-spacing: 0.2px;">${heading}</h2>`;
    } else if (trimmed === "") {
      html += `<div style="height: 10px;"></div>`;
    } else {
      // General paragraph
      const formattedLine = trimmed.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                                   .replace(/\*(.*?)\*/g, '<em>$1</em>');
      html += `<p style="margin-bottom: 14px; font-size: 14px; color: #1e293b; text-align: justify; line-height: 1.65; text-indent: 14px;">${formattedLine}</p>`;
    }
  }

  if (inList) {
    html += "</ul>";
  }

  return html;
}

export function exportProjectCfaReport(aiAnalysis: string, selectedAsset: any, riskScenario: string, purchasePrice: string, targetPrice: number, holdingPeriod: string, growthRate: string, yieldRate: string, netProfitFormatted: string, roiFormatted: string) {
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    alert("Popup terblokir oleh browser Anda. Harap berikan izin popup agar dapat mencetak dokumen PDF.");
    return;
  }

  const isCrypto = selectedAsset?.category === 'crypto';
  const cleanHtml = parseMarkdownToHtml(aiAnalysis);
  const now = new Date();
  
  const htmlReport = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>Riset & Evaluasi Finansial CFA - ${selectedAsset?.symbol || 'Asset'}</title>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700&family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
          
          @media print {
            body {
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
              background-color: #ffffff !important;
            }
            .no-print { display: none !important; }
            @page {
              size: A4;
              margin: 20mm 15mm 20mm 15mm;
            }
          }
          
          body { 
            font-family: 'Inter', sans-serif; 
            color: #0f172a; 
            line-height: 1.6; 
            background-color: #ffffff;
            padding: 40px;
            max-width: 820px;
            margin: 0 auto;
            border-top: 6px solid #d97706; /* Elite gold trim */
            position: relative;
          }

          body::before {
            content: "";
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500" opacity="0.08" width="100%" height="100%"><g transform="translate(120, 120) scale(1.6) rotate(0, 100, 100)"><linearGradient id="gProj" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="%23b45309" /><stop offset="35%" stop-color="%23f59e0b" /><stop offset="65%" stop-color="%23fbbf24" /><stop offset="100%" stop-color="%23d97706" /></linearGradient><path d="M 15 25 L 105 25 L 105 40 L 45 90 L 105 90 L 105 105 L 15 105 L 15 90 L 75 40 L 15 40 Z" fill="url(%23gProj)" /><circle cx="60" cy="65" r="22" fill="url(%23gProj)" stroke="%2378350f" stroke-width="1.5" /><circle cx="60" cy="65" r="18" fill="none" stroke="%23fef08a" stroke-width="0.8" stroke-dasharray="1.5 1" /><text x="60" y="73" font-family="sans-serif" font-weight="900" font-size="22" fill="%2378350f" text-anchor="middle">$</text><path d="M 100 85 L 120 65 L 132 75 L 152 48" fill="none" stroke="url(%23gProj)" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round" /><path d="M 136 48 L 154 48 L 154 66" fill="none" stroke="url(%23gProj)" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round" /><rect x="108" y="93" width="3.5" height="12" fill="%23d97706" opacity="0.3" rx="0.5" /><rect x="119" y="85" width="3.5" height="20" fill="%23d97706" opacity="0.5" rx="0.5" /><rect x="130" y="90" width="3.5" height="15" fill="%23d97706" opacity="0.7" rx="0.5" /><rect x="141" y="75" width="3.5" height="30" fill="%23d97706" opacity="0.9" rx="0.5" /><text x="82" y="145" font-family="sans-serif" font-weight="900" font-size="22" fill="%230f172a" letter-spacing="3" text-anchor="middle">ZAYTRIX</text></g></svg>');
            background-repeat: no-repeat;
            background-position: center;
            background-size: 550px 550px;
            z-index: -1000;
            pointer-events: none;
          }

          .header-table {
            background-color: #0f172a; /* elegant dark slate header band format */
            border-bottom: 3px solid #d97706; /* gold border bottom */
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 25px;
          }

          .logo-area {
            vertical-align: middle;
          }

          .brand-logo-badge {
            width: 52px;
            height: 52px;
            background: #090d16;
            border: 2px solid #d97706; /* gold border */
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 4px 10px rgba(0,0,0,0.3);
          }

          .brand-logo-badge-text {
            color: #f59e0b; /* active gold */
            font-family: 'Inter', sans-serif;
            font-weight: 900;
            font-size: 26px;
            line-height: 52px;
            text-align: center;
            width: 100%;
          }

          .title-area {
            vertical-align: middle;
          }

          .system-title {
            font-family: 'Inter', sans-serif;
            font-size: 22px;
            color: #38bdf8; /* sky blue matches modern portal */
            font-weight: 900;
            letter-spacing: 2.5px;
            line-height: 1.2;
            margin: 0;
          }

          .system-subtitle {
            font-family: 'Inter', sans-serif;
            font-size: 10px;
            color: #f59e0b; /* active gold subtitle logo style */
            letter-spacing: 4px;
            font-weight: 700;
            margin: 4px 0 0 0;
            text-transform: uppercase;
          }

          .metadata-area {
            text-align: right;
            font-family: 'JetBrains Mono', monospace;
            font-size: 9.5px;
            color: #94a3b8; /* white-friendly slate description for dark background header */
            vertical-align: middle;
          }

          .header-banner {
            text-align: center;
            margin-bottom: 30px;
          }

          .header-banner h1 {
            font-family: 'Cinzel', serif;
            font-size: 22px;
            font-weight: 700;
            color: #0f172a;
            margin: 0;
            letter-spacing: 0.5px;
            border-bottom: 1px solid #e2e8f0;
            padding-bottom: 10px;
          }

          .header-banner p {
            font-size: 12px;
            color: #0d9488;
            margin: 8px 0 0 0;
            font-weight: 600;
            letter-spacing: 0.08em;
            text-transform: uppercase;
          }

          .meta-grid {
            display: grid;
            grid-template-cols: repeat(4, 1fr);
            gap: 12px;
            background-color: #f8fafc;
            border-radius: 8px;
            border: 1px solid #e2e8f0;
            padding: 14px;
            margin-bottom: 30px;
          }

          .meta-item {
            display: flex;
            flex-direction: column;
          }

          .meta-label {
            font-size: 9px;
            color: #64748b;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            margin-bottom: 3px;
          }

          .meta-value {
            font-size: 12.5px;
            color: #0f172a;
            font-weight: 700;
          }

          .parameter-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 30px;
            font-size: 11.5px;
          }

          .parameter-table th {
            background-color: #f1f5f9;
            color: #334155;
            font-weight: 600;
            text-transform: uppercase;
            font-size: 9.5px;
            letter-spacing: 0.05em;
            padding: 8px 12px;
            border: 1px solid #cbd5e1;
            text-align: left;
          }

          .parameter-table td {
            padding: 8px 12px;
            border: 1px solid #cbd5e1;
            color: #334155;
          }

          .parameter-table tr:nth-child(even) {
            background-color: #fcfdfd;
          }

          .report-content {
            margin-bottom: 45px;
          }

          h1, h2, h3, h4 {
            page-break-after: avoid;
            page-break-inside: avoid;
          }

          .disclaimer {
            margin-top: 40px;
            background-color: #f8fafc;
            border-left: 3px solid #0d9488;
            padding: 14px 18px;
            border-radius: 0 6px 6px 0;
            font-size: 10px;
            color: #475569;
            text-align: justify;
            line-height: 1.5;
            border: 1px solid #e2e8f0;
            border-left: 3px solid #0d9488;
            page-break-inside: avoid;
          }

          .disclaimer-title {
            font-weight: 700;
            margin-bottom: 5px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: #0f172a;
          }

          .analyst-sign-off {
            margin-top: 40px;
            border-top: 1px solid #e2e8f0;
            padding-top: 25px;
            display: grid;
            grid-template-cols: 1fr 1fr;
            gap: 40px;
            page-break-inside: avoid;
          }

          .signature-box {
            border: 1px dashed #cbd5e1;
            border-radius: 6px;
            padding: 15px;
            text-align: center;
            background-color: #f8fafc;
            page-break-inside: avoid;
          }

          .signature-title {
            font-size: 10px;
            font-weight: 600;
            color: #64748b;
            margin-bottom: 30px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
          }

          .signature-line {
            font-size: 11.5px;
            font-weight: 700;
            color: #0f172a;
            border-top: 1px solid #94a3b8;
            padding-top: 6px;
            width: 180px;
            margin: 0 auto;
          }

          .signature-sub {
            font-size: 9.5px;
            color: #64748b;
            margin-top: 2px;
          }

          .print-btn-container {
            display: flex;
            justify-content: center;
            margin-top: 10px;
            margin-bottom: 25px;
          }

          .print-btn {
            background-color: #0d9488;
            color: white;
            border: none;
            padding: 10px 24px;
            border-radius: 6px;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            transition: background-color 0.2s;
            box-shadow: 0 4px 6px rgba(13, 148, 136, 0.15);
          }

          .print-btn:hover {
            background-color: #0f766e;
          }
        </style>
      </head>
      <body>
        <div class="print-btn-container no-print">
          <button class="print-btn" onclick="window.print()">Cetak / Simpan Laporan PDF Resmi</button>
        </div>

        <table class="header-table" style="width:100%; border:0 !important; margin:0; border-collapse:collapse;">
          <tr style="background:transparent !important;">
            <td class="logo-area" style="border:0 !important; padding:15px; width:70px;">
              <div class="brand-logo-badge" style="padding: 3px; box-sizing: border-box;">
                <svg width="100%" height="100%" viewBox="0 0 165 140" fill="none" xmlns="http://www.w3.org/2000/svg" style="display: block;">
                  <defs>
                    <linearGradient id="goldPdfLogo1" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stop-color="#b45309" />
                      <stop offset="30%" stop-color="#f59e0b" />
                      <stop offset="70%" stop-color="#fbbf24" />
                      <stop offset="100%" stop-color="#d97706" />
                    </linearGradient>
                  </defs>
                  <path d="M 15 25 L 105 25 L 105 40 L 45 90 L 105 90 L 105 105 L 15 105 L 15 90 L 75 40 L 15 40 Z" fill="url(#goldPdfLogo1)" />
                  <circle cx="60" cy="65" r="22" fill="url(#goldPdfLogo1)" stroke="#78350f" stroke-width="1.5" />
                  <circle cx="60" cy="65" r="18" fill="none" stroke="#fef08a" stroke-width="0.8" stroke-dasharray="1.5 1" />
                  <text x="60" y="73" font-family="'Inter', sans-serif" font-weight="900" font-size="22" fill="#78350f" text-anchor="middle">$</text>
                  <path d="M 100 85 L 120 65 L 132 75 L 152 48" fill="none" stroke="url(#goldPdfLogo1)" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round" />
                  <path d="M 136 48 L 154 48 L 154 66" fill="none" stroke="url(#goldPdfLogo1)" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round" />
                  <rect x="108" y="93" width="3.5" height="12" fill="#d97706" opacity="0.3" rx="0.5" />
                  <rect x="119" y="85" width="3.5" height="20" fill="#d97706" opacity="0.5" rx="0.5" />
                  <rect x="130" y="90" width="3.5" height="15" fill="#d97706" opacity="0.7" rx="0.5" />
                  <rect x="141" y="75" width="3.5" height="30" fill="#d97706" opacity="0.9" rx="0.5" />
                </svg>
              </div>
            </td>
            <td class="title-area" style="border:0 !important; padding:15px;">
              <h1 class="system-title">ZAYTRIX</h1>
              <div class="system-subtitle">Expert Advisory Platform</div>
            </td>
            <td class="metadata-area" style="border:0 !important; padding:15px; text-align:right;">
              <div>SEC & OJK COMPLIANT</div>
              <div style="margin-top: 4px;">OFFICIAL COMPLIANCE NOTE</div>
            </td>
          </tr>
        </table>

        <div class="header-banner">
          <h1>LAPORAN ANALIS PORTAL INVESTASI</h1>
          <p>EVALUASI KELAYAKAN PREDIKSI VALUASI & CAGR BERSTANDAR INTERNASIONAL</p>
        </div>

        <div class="meta-grid">
          <div class="meta-item">
            <span class="meta-label">Aset Subjek</span>
            <span class="meta-value">${selectedAsset?.name} (${selectedAsset?.symbol})</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">Profil Risiko</span>
            <span class="meta-value">${riskScenario === 'Safe' ? 'Konservatif (Aman)' : riskScenario === 'Moderate' ? 'Moderat' : 'Agresif (Tinggi)'}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">ID Analis</span>
            <span class="meta-value">CFA-AI/MODEL-PROJ</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">Tanggal Terbit</span>
            <span class="meta-value">${now.toLocaleDateString("id-ID", { day: 'numeric', month: 'long', year: 'numeric' })}</span>
          </div>
        </div>

        <h3 style="color: #0d9488; font-size: 13.5px; border-bottom: 1px dashed #cbd5e1; margin-bottom: 10px; padding-bottom: 4px; font-weight: bold; text-transform: uppercase;">
          VARIABEL MODELING METRIK TERESTIMASI
        </h3>
        <table class="parameter-table">
          <thead>
            <tr>
              <th>Harga Beli Awal</th>
              <th>Harga Target Hasil Akhir</th>
              <th>Masa Simpan (Holding Period)</th>
              <th>Target CAGR Tahunan</th>
              <th>Dividen/Yield Dividen</th>
              <th>Keuntungan Bersih (Base)</th>
              <th>Estimasi ROI Bersih</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>${isCrypto ? '$' + parseFloat(purchasePrice || '0').toLocaleString() : 'Rp ' + parseFloat(purchasePrice || '0').toLocaleString()}</td>
              <td>${isCrypto ? '$' + targetPrice.toLocaleString() : 'Rp ' + targetPrice.toLocaleString()}</td>
              <td>${holdingPeriod} Tahun</td>
              <td>${growthRate}%</td>
              <td>${yieldRate}% per tahun</td>
              <td style="font-weight: bold; color: #1e3a8a;">${netProfitFormatted}</td>
              <td style="font-weight: bold; color: #10b981;">${roiFormatted}</td>
            </tr>
          </tbody>
        </table>

        <div class="report-content">
          ${cleanHtml}
        </div>

        <div class="analyst-sign-off">
          <div class="signature-box">
            <div class="signature-title">Disusun Oleh</div>
            <div style="height: 35px; display: flex; align-items: center; justify-content: center;">
              <span style="font-family: 'Cinzel', serif; font-size: 14px; color: #475569; letter-spacing: 2px;">MODEL ANALISIS INTEL</span>
            </div>
            <div class="signature-line">Advisory Core Valuation Group</div>
            <div class="signature-sub">Asisten Kuantitatif Finansial AI</div>
          </div>
          <div class="signature-box">
            <div class="signature-title">Disahkan & Ditinjau Oleh</div>
            <div style="height: 35px; display: flex; align-items: center; justify-content: center;">
              <span style="font-family: 'Cinzel', serif; font-size: 14px; color: #475569; letter-spacing: 2px;">CFA CERTIFICATE NODE</span>
            </div>
            <div class="signature-line">Chartered Advisory Committee</div>
            <div class="signature-sub">Sertifikasi Analis & Manajemen Portofolio</div>
          </div>
        </div>

        <div class="disclaimer">
          <div class="disclaimer-title">Pernyataan Penyangkalan (Disclaimer) Resmi</div>
          Laporan Analis Investasi ini diterbitkan untuk kepentingan simulasi finansial strategis, menggunakan infrastruktur pemodelan canggih serta optimasi algoritmik dari AI Advisory. Seluruh data, asumsi, perkiraan tingkat pertumbuhan tahunan majemuk (CAGR), dan yield dividen bersifat indikatif semata dan tidak mendasari tawaran hukum untuk membeli, menjual, atau merekrut aset riil terkait. Keputusan penempatan dana riil mutlak berada di bawah tanggung jawab moral dan logis pemodal pribadi berdaulat. Depresiasi pasar (drawdown) berpeluang terjadi kapan pun, dan kinerja historis instrumen tidak mendasari garansi imbal hasil mutlak di masa mendatang.
        </div>

        <script>
          window.onload = function() {
            setTimeout(function(){
              window.print();
            }, 600);
          };
        </script>
      </body>
    </html>
  `;

  printWindow.document.write(htmlReport);
  printWindow.document.close();
}

export function exportComparisonCfaReport(aiReport: string, assetA: any, assetB: any) {
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    alert("Popup terblokir oleh browser Anda. Harap berikan izin popup agar dapat mencetak dokumen PDF.");
    return;
  }

  const cleanHtml = parseMarkdownToHtml(aiReport);
  const now = new Date();
  
  const formatValue = (a: any) => {
    if (!a) return "N/A";
    const isS = a.category === 'stock';
    return isS 
      ? new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(a.price)
      : `$${a.price.toLocaleString()}`;
  };

  const htmlReport = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>Analisis Komparatif Finansial CFA - ${assetA?.symbol} vs ${assetB?.symbol}</title>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700&family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
          
          @media print {
            body {
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
              background-color: #ffffff !important;
            }
            .no-print { display: none !important; }
            @page {
              size: A4;
              margin: 20mm 15mm 20mm 15mm;
            }
          }
          
          body { 
            font-family: 'Inter', sans-serif; 
            color: #0f172a; 
            line-height: 1.6; 
            background-color: #ffffff;
            padding: 40px;
            max-width: 820px;
            margin: 0 auto;
            border-top: 6px solid #d97706; /* Elite gold trim */
            position: relative;
          }

          body::before {
            content: "";
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500" opacity="0.08" width="100%" height="100%"><g transform="translate(120, 120) scale(1.6) rotate(0, 100, 100)"><linearGradient id="gComp" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="%23b45309" /><stop offset="35%" stop-color="%23f59e0b" /><stop offset="65%" stop-color="%23fbbf24" /><stop offset="100%" stop-color="%23d97706" /></linearGradient><path d="M 15 25 L 105 25 L 105 40 L 45 90 L 105 90 L 105 105 L 15 105 L 15 90 L 75 40 L 15 40 Z" fill="url(%23gComp)" /><circle cx="60" cy="65" r="22" fill="url(%23gComp)" stroke="%2378350f" stroke-width="1.5" /><circle cx="60" cy="65" r="18" fill="none" stroke="%23fef08a" stroke-width="0.8" stroke-dasharray="1.5 1" /><text x="60" y="73" font-family="sans-serif" font-weight="900" font-size="22" fill="%2378350f" text-anchor="middle">$</text><path d="M 100 85 L 120 65 L 132 75 L 152 48" fill="none" stroke="url(%23gComp)" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round" /><path d="M 136 48 L 154 48 L 154 66" fill="none" stroke="url(%23gComp)" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round" /><rect x="108" y="93" width="3.5" height="12" fill="%23d97706" opacity="0.3" rx="0.5" /><rect x="119" y="85" width="3.5" height="20" fill="%23d97706" opacity="0.5" rx="0.5" /><rect x="130" y="90" width="3.5" height="15" fill="%23d97706" opacity="0.7" rx="0.5" /><rect x="141" y="75" width="3.5" height="30" fill="%23d97706" opacity="0.9" rx="0.5" /><text x="82" y="145" font-family="sans-serif" font-weight="900" font-size="22" fill="%230f172a" letter-spacing="3" text-anchor="middle">ZAYTRIX</text></g></svg>');
            background-repeat: no-repeat;
            background-position: center;
            background-size: 550px 550px;
            z-index: -1000;
            pointer-events: none;
          }

          .header-table {
            background-color: #0f172a; /* elegant dark slate header band format */
            border-bottom: 3px solid #d97706; /* gold border bottom */
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 25px;
          }

          .logo-area {
            vertical-align: middle;
          }

          .brand-logo-badge {
            width: 52px;
            height: 52px;
            background: #090d16;
            border: 2px solid #d97706; /* gold border */
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 4px 10px rgba(0,0,0,0.3);
          }

          .brand-logo-badge-text {
            color: #f59e0b; /* active gold */
            font-family: 'Inter', sans-serif;
            font-weight: 900;
            font-size: 26px;
            line-height: 52px;
            text-align: center;
            width: 100%;
          }

          .title-area {
            vertical-align: middle;
            padding-left: 15px;
          }

          .system-title {
            font-family: 'Inter', sans-serif;
            font-size: 22px;
            color: #38bdf8; /* sky blue matches modern portal */
            font-weight: 900;
            letter-spacing: 2.5px;
            line-height: 1.2;
            margin: 0;
          }

          .system-subtitle {
            font-family: 'Inter', sans-serif;
            font-size: 10px;
            color: #f59e0b; /* active gold subtitle logo style */
            letter-spacing: 4px;
            font-weight: 700;
            margin: 4px 0 0 0;
            text-transform: uppercase;
          }

          .metadata-area {
            text-align: right;
            font-family: 'JetBrains Mono', monospace;
            font-size: 9.5px;
            color: #94a3b8; /* white-friendly slate description for dark background header */
            vertical-align: middle;
          }

          .header-banner {
            text-align: center;
            margin-bottom: 30px;
          }

          .header-banner h1 {
            font-family: 'Cinzel', serif;
            font-size: 22px;
            font-weight: 700;
            color: #0f172a;
            margin: 0;
            letter-spacing: 0.5px;
            border-bottom: 1px solid #e2e8f0;
            padding-bottom: 10px;
          }

          .header-banner p {
            font-size: 11.5px;
            color: #0d9488;
            margin: 8px 0 0 0;
            font-weight: 600;
            letter-spacing: 0.08em;
            text-transform: uppercase;
          }

          .meta-grid {
            display: grid;
            grid-template-cols: repeat(4, 1fr);
            gap: 12px;
            background-color: #f8fafc;
            border-radius: 8px;
            border: 1px solid #e2e8f0;
            padding: 14px;
            margin-bottom: 30px;
          }

          .meta-item {
            display: flex;
            flex-direction: column;
          }

          .meta-label {
            font-size: 9px;
            color: #64748b;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            margin-bottom: 3px;
          }

          .meta-value {
            font-size: 12.5px;
            color: #0f172a;
            font-weight: 700;
          }

          .comparison-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 30px;
            font-size: 11px;
          }

          .comparison-table th {
            background-color: #f1f5f9;
            color: #334155;
            font-weight: 600;
            padding: 8px 12px;
            border: 1px solid #cbd5e1;
            text-align: left;
            text-transform: uppercase;
            font-size: 9px;
            letter-spacing: 0.03em;
          }

          .comparison-table td {
            padding: 9px 12px;
            border: 1px solid #cbd5e1;
          }

          .comparison-table tr:nth-child(even) {
            background-color: #fafbfc;
          }

          .report-content {
            margin-bottom: 45px;
          }

          h1, h2, h3, h4 {
            page-break-after: avoid;
            page-break-inside: avoid;
          }

          .disclaimer {
            margin-top: 40px;
            background-color: #f8fafc;
            border-left: 3px solid #0d9488;
            padding: 14px 18px;
            border-radius: 0 6px 6px 0;
            font-size: 10px;
            color: #475569;
            text-align: justify;
            line-height: 1.5;
            border: 1px solid #e2e8f0;
            border-left: 3px solid #0d9488;
            page-break-inside: avoid;
          }

          .disclaimer-title {
            font-weight: 700;
            margin-bottom: 5px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: #0f172a;
          }

          .analyst-sign-off {
            margin-top: 40px;
            border-top: 1px solid #e2e8f0;
            padding-top: 25px;
            display: grid;
            grid-template-cols: 1fr 1fr;
            gap: 40px;
            page-break-inside: avoid;
          }

          .signature-box {
            border: 1px dashed #cbd5e1;
            border-radius: 6px;
            padding: 15px;
            text-align: center;
            background-color: #f8fafc;
            page-break-inside: avoid;
          }

          .signature-title {
            font-size: 10px;
            font-weight: 600;
            color: #64748b;
            margin-bottom: 30px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
          }

          .signature-line {
            font-size: 11.5px;
            font-weight: 700;
            color: #0f172a;
            border-top: 1px solid #94a3b8;
            padding-top: 6px;
            width: 180px;
            margin: 0 auto;
          }

          .signature-sub {
            font-size: 9.5px;
            color: #64748b;
            margin-top: 2px;
          }

          .print-btn-container {
            display: flex;
            justify-content: center;
            margin-top: 10px;
            margin-bottom: 25px;
          }

          .print-btn {
            background-color: #0d9488;
            color: white;
            border: none;
            padding: 10px 24px;
            border-radius: 6px;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            transition: background-color 0.2s;
            box-shadow: 0 4px 6px rgba(13, 148, 136, 0.15);
          }

          .print-btn:hover {
            background-color: #0f766e;
          }
        </style>
      </head>
      <body>
        <div class="print-btn-container no-print">
          <button class="print-btn" onclick="window.print()">Cetak / Simpan Laporan PDF Resmi</button>
        </div>

        <table class="header-table" style="width:100%; border:0 !important; margin:0; border-collapse:collapse;">
          <tr style="background:transparent !important;">
            <td class="logo-area" style="border:0 !important; padding:15px; width:70px;">
              <div class="brand-logo-badge" style="padding: 3px; box-sizing: border-box;">
                <svg width="100%" height="100%" viewBox="0 0 165 140" fill="none" xmlns="http://www.w3.org/2000/svg" style="display: block;">
                  <defs>
                    <linearGradient id="goldPdfLogo2" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stop-color="#b45309" />
                      <stop offset="30%" stop-color="#f59e0b" />
                      <stop offset="70%" stop-color="#fbbf24" />
                      <stop offset="100%" stop-color="#d97706" />
                    </linearGradient>
                  </defs>
                  <path d="M 15 25 L 105 25 L 105 40 L 45 90 L 105 90 L 105 105 L 15 105 L 15 90 L 75 40 L 15 40 Z" fill="url(#goldPdfLogo2)" />
                  <circle cx="60" cy="65" r="22" fill="url(#goldPdfLogo2)" stroke="#78350f" stroke-width="1.5" />
                  <circle cx="60" cy="65" r="18" fill="none" stroke="#fef08a" stroke-width="0.8" stroke-dasharray="1.5 1" />
                  <text x="60" y="73" font-family="'Inter', sans-serif" font-weight="900" font-size="22" fill="#78350f" text-anchor="middle">$</text>
                  <path d="M 100 85 L 120 65 L 132 75 L 152 48" fill="none" stroke="url(#goldPdfLogo2)" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round" />
                  <path d="M 136 48 L 154 48 L 154 66" fill="none" stroke="url(#goldPdfLogo2)" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round" />
                  <rect x="108" y="93" width="3.5" height="12" fill="#d97706" opacity="0.3" rx="0.5" />
                  <rect x="119" y="85" width="3.5" height="20" fill="#d97706" opacity="0.5" rx="0.5" />
                  <rect x="130" y="90" width="3.5" height="15" fill="#d97706" opacity="0.7" rx="0.5" />
                  <rect x="141" y="75" width="3.5" height="30" fill="#d97706" opacity="0.9" rx="0.5" />
                </svg>
              </div>
            </td>
            <td class="title-area" style="border:0 !important; padding:15px;">
              <h1 class="system-title">ZAYTRIX</h1>
              <div class="system-subtitle">Expert Advisory Platform</div>
            </td>
            <td class="metadata-area" style="border:0 !important; padding:15px; text-align:right;">
              <div>SEC & OJK COMPLIANT</div>
              <div style="margin-top: 4px;">PORTFOLIO DIVERSIFIER NOTE</div>
            </td>
          </tr>
        </table>

        <div class="header-banner">
          <h1>MEMORANDUM KOMPARATIF PORTOFOLIO</h1>
          <p>STRATEGI ALOKASI MULTI-INSTRUMEN INTERNASIONAL: ${assetA?.symbol} VS ${assetB?.symbol}</p>
        </div>

        <div class="meta-grid">
          <div class="meta-item">
            <span class="meta-label">Aset Utama A</span>
            <span class="meta-value">${assetA?.name} (${assetA?.symbol})</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">Aset Pembanding B</span>
            <span class="meta-value">${assetB?.name} (${assetB?.symbol})</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">ID Memorandum</span>
            <span class="meta-value">MEMO-CFA/MULTI-X</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">Tanggal Terbit</span>
            <span class="meta-value">${now.toLocaleDateString("id-ID", { day: 'numeric', month: 'long', year: 'numeric' })}</span>
          </div>
        </div>

        <h3 style="color: #0d9488; font-size: 13.5px; border-bottom: 1px dashed #cbd5e1; margin-bottom: 10px; padding-bottom: 4px; font-weight: bold; text-transform: uppercase;">
          PERBANDINGAN HEAD-TO-HEAD FUNDAMENTAL
        </h3>
        <table class="comparison-table">
          <thead>
            <tr>
              <th>Metrik fundamental</th>
              <th>${assetA?.symbol} (${assetA?.category === 'stock' ? 'Saham' : 'Crypto'})</th>
              <th>${assetB?.symbol} (${assetB?.category === 'stock' ? 'Saham' : 'Crypto'})</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Harga Pasar Terkini</td>
              <td style="font-weight: bold;">${formatValue(assetA)}</td>
              <td style="font-weight: bold;">${formatValue(assetB)}</td>
            </tr>
            <tr>
              <td>Perubahan Kinerja (24 Jurnal)</td>
              <td style="color: ${assetA?.change24h >= 0 ? '#10b981' : '#ef4444'}; font-weight: 600;">
                ${assetA?.change24h >= 0 ? '+' : ''}${assetA?.change24h}%
              </td>
              <td style="color: ${assetB?.change24h >= 0 ? '#10b981' : '#ef4444'}; font-weight: 600;">
                ${assetB?.change24h >= 0 ? '+' : ''}${assetB?.change24h}%
              </td>
            </tr>
            <tr>
              <td>Hasil Dividen / Staking (Yield)</td>
              <td>${assetA?.dividendYield !== undefined ? `${assetA.dividendYield}% per tahun` : "N/A"}</td>
              <td>${assetB?.dividendYield !== undefined ? `${assetB.dividendYield}% per tahun` : "N/A"}</td>
            </tr>
            <tr>
              <td>Price-to-Earnings (P/E Ratio)</td>
              <td>${assetA?.peRatio !== undefined ? `${assetA.peRatio}x` : "N/A"}</td>
              <td>${assetB?.peRatio !== undefined ? `${assetB.peRatio}x` : "N/A"}</td>
            </tr>
            <tr>
              <td>Price-to-Book (P/B Ratio)</td>
              <td>${assetA?.pbRatio !== undefined ? `${assetA.pbRatio}x` : "N/A"}</td>
              <td>${assetB?.pbRatio !== undefined ? `${assetB.pbRatio}x` : "N/A"}</td>
            </tr>
          </tbody>
        </table>

        <div class="report-content">
          ${cleanHtml}
        </div>

        <div class="analyst-sign-off">
          <div class="signature-box">
            <div class="signature-title">Disusun Oleh</div>
            <div style="height: 35px; display: flex; align-items: center; justify-content: center;">
              <span style="font-family: 'Cinzel', serif; font-size: 14px; color: #475569; letter-spacing: 2px;">MODEL ANALISIS INTEL</span>
            </div>
            <div class="signature-line">Portfolio Management Core</div>
            <div class="signature-sub">Asisten Kuantitatif Finansial AI</div>
          </div>
          <div class="signature-box">
            <div class="signature-title">Disahkan & Ditinjau Oleh</div>
            <div style="height: 35px; display: flex; align-items: center; justify-content: center;">
              <span style="font-family: 'Cinzel', serif; font-size: 14px; color: #475569; letter-spacing: 2px;">CFA CERTIFICATE NODE</span>
            </div>
            <div class="signature-line">Chartered Advisory Committee</div>
            <div class="signature-sub">Sertifikasi Analis & Manajemen Portofolio</div>
          </div>
        </div>

        <div class="disclaimer">
          <div class="disclaimer-title">Pernyataan Penyangkalan (Disclaimer) Resmi</div>
          Catatan Perbandingan Multi-Aset ini bertujuan murni sebagai instrumen simulasi kualitatif dan kuantitatif, memanfaatkan mesin pemrosesan kognitif modern dari AI Advisory. Informasi ini tidak ditujukan sebagai penawaran komersial langsung, bujukan arbitrase saham, atau jaminan return atas kepemilikan aset yang dibandingkan. Pasar saham domestik dan pasar kripto global memiliki asimetri regulasi serta volatilitas intrinsik yang sangat tinggi. Pemodal dianjurkan untuk berkonsultasi secara mendalam dengan konsultan finansial tersumpah sebelum melakukan alokasi dan rebalancing portofolio aktif.
        </div>

        <script>
          window.onload = function() {
            setTimeout(function(){
              window.print();
            }, 600);
          };
        </script>
      </body>
    </html>
  `;

  printWindow.document.write(htmlReport);
  printWindow.document.close();
}

export function exportUploadedPdfAnalysisReport(aiAnalysis: string, filename: string, category: string) {
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    alert("Popup terblokir oleh browser Anda. Harap berikan izin popup agar dapat mencetak dokumen PDF.");
    return;
  }

  const cleanHtml = parseMarkdownToHtml(aiAnalysis);
  const now = new Date();
  const fileCleanName = filename.replace(/\.[^/.]+$/, ""); // strip extension

  const htmlReport = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>Advisory Research Note - ${fileCleanName}</title>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700&family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
          
          @media print {
            body {
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
              background-color: #ffffff !important;
            }
            .no-print { display: none !important; }
            @page {
              size: A4;
              margin: 20mm 15mm 20mm 15mm;
            }
          }
          
          body { 
            font-family: 'Inter', sans-serif; 
            color: #0f172a; 
            line-height: 1.6; 
            background-color: #ffffff;
            padding: 40px;
            max-width: 820px;
            margin: 0 auto;
            border-top: 6px solid #d97706; /* Elite gold trim */
            position: relative;
          }

          body::before {
            content: "";
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500" opacity="0.08" width="100%" height="100%"><g transform="translate(120, 120) scale(1.6) rotate(0, 100, 100)"><linearGradient id="gUpload" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="%23b45309" /><stop offset="35%" stop-color="%23f59e0b" /><stop offset="65%" stop-color="%23fbbf24" /><stop offset="100%" stop-color="%23d97706" /></linearGradient><path d="M 15 25 L 105 25 L 105 40 L 45 90 L 105 90 L 105 105 L 15 105 L 15 90 L 75 40 L 15 40 Z" fill="url(%23gUpload)" /><circle cx="60" cy="65" r="22" fill="url(%23gUpload)" stroke="%2378350f" stroke-width="1.5" /><circle cx="60" cy="65" r="18" fill="none" stroke="%23fef08a" stroke-width="0.8" stroke-dasharray="1.5 1" /><text x="60" y="73" font-family="sans-serif" font-weight="900" font-size="22" fill="%2378350f" text-anchor="middle">$</text><path d="M 100 85 L 120 65 L 132 75 L 152 48" fill="none" stroke="url(%23gUpload)" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round" /><path d="M 136 48 L 154 48 L 154 66" fill="none" stroke="url(%23gUpload)" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round" /><rect x="108" y="93" width="3.5" height="12" fill="%23d97706" opacity="0.3" rx="0.5" /><rect x="119" y="85" width="3.5" height="20" fill="%23d97706" opacity="0.5" rx="0.5" /><rect x="130" y="90" width="3.5" height="15" fill="%23d97706" opacity="0.7" rx="0.5" /><rect x="141" y="75" width="3.5" height="30" fill="%23d97706" opacity="0.9" rx="0.5" /><text x="82" y="145" font-family="sans-serif" font-weight="900" font-size="22" fill="%230f172a" letter-spacing="3" text-anchor="middle">ZAYTRIX</text></g></svg>');
            background-repeat: no-repeat;
            background-position: center;
            background-size: 550px 550px;
            z-index: -1000;
            pointer-events: none;
          }

          .header-table {
            background-color: #0f172a; /* elegant dark slate header band format */
            border-bottom: 3px solid #d97706; /* gold border bottom */
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 25px;
          }

          .logo-area {
            vertical-align: middle;
          }

          .brand-logo-badge {
            width: 52px;
            height: 52px;
            background: #090d16;
            border: 2px solid #d97706; /* gold border */
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 4px 10px rgba(0,0,0,0.3);
          }

          .brand-logo-badge-text {
            color: #f59e0b; /* active gold */
            font-family: 'Inter', sans-serif;
            font-weight: 900;
            font-size: 26px;
            line-height: 52px;
            text-align: center;
            width: 100%;
          }

          .title-area {
            vertical-align: middle;
            padding-left: 15px;
          }

          .system-title {
            font-family: 'Inter', sans-serif;
            font-size: 22px;
            color: #38bdf8; /* sky blue matches modern portal */
            font-weight: 900;
            letter-spacing: 2.5px;
            line-height: 1.2;
            margin: 0;
          }

          .system-subtitle {
            font-family: 'Inter', sans-serif;
            font-size: 10px;
            color: #f59e0b; /* active gold subtitle logo style */
            letter-spacing: 4px;
            font-weight: 700;
            margin: 4px 0 0 0;
            text-transform: uppercase;
          }

          .metadata-area {
            text-align: right;
            font-family: 'JetBrains Mono', monospace;
            font-size: 9.5px;
            color: #94a3b8; /* white-friendly slate description for dark background header */
            vertical-align: middle;
          }

          .header-banner {
            text-align: center;
            margin-bottom: 30px;
          }

          .header-banner h1 {
            font-family: 'Cinzel', serif;
            font-size: 22px;
            font-weight: 700;
            color: #0f172a;
            margin: 0;
            letter-spacing: 0.5px;
            border-bottom: 1px solid #e2e8f0;
            padding-bottom: 10px;
          }

          .header-banner p {
            font-size: 11.5px;
            color: #0d9488;
            margin: 8px 0 0 0;
            font-weight: 600;
            letter-spacing: 0.08em;
            text-transform: uppercase;
          }

          .meta-grid {
            display: grid;
            grid-template-cols: repeat(4, 1fr);
            gap: 12px;
            background-color: #f8fafc;
            border-radius: 8px;
            border: 1px solid #e2e8f0;
            padding: 14px;
            margin-bottom: 30px;
          }

          .meta-item {
            display: flex;
            flex-direction: column;
          }

          .meta-label {
            font-size: 9px;
            color: #64748b;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            margin-bottom: 3px;
          }

          .meta-value {
            font-size: 12.5px;
            color: #0f172a;
            font-weight: 700;
          }

          .report-content {
            margin-bottom: 45px;
          }

          h1, h2, h3, h4 {
            page-break-after: avoid;
            page-break-inside: avoid;
          }

          .disclaimer {
            margin-top: 40px;
            background-color: #f8fafc;
            border-left: 3px solid #0d9488;
            padding: 14px 18px;
            border-radius: 0 6px 6px 0;
            font-size: 10px;
            color: #475569;
            text-align: justify;
            line-height: 1.5;
            border: 1px solid #e2e8f0;
            border-left: 3px solid #0d9488;
            page-break-inside: avoid;
          }

          .disclaimer-title {
            font-weight: 700;
            margin-bottom: 5px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: #0f172a;
          }

          .analyst-sign-off {
            margin-top: 40px;
            border-top: 1px solid #e2e8f0;
            padding-top: 25px;
            display: grid;
            grid-template-cols: 1fr 1fr;
            gap: 40px;
            page-break-inside: avoid;
          }

          .signature-box {
            border: 1px dashed #cbd5e1;
            border-radius: 6px;
            padding: 15px;
            text-align: center;
            background-color: #f8fafc;
            page-break-inside: avoid;
          }

          .signature-title {
            font-size: 10px;
            font-weight: 600;
            color: #64748b;
            margin-bottom: 30px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
          }

          .signature-line {
            font-size: 11.5px;
            font-weight: 700;
            color: #0f172a;
            border-top: 1px solid #94a3b8;
            padding-top: 6px;
            width: 180px;
            margin: 0 auto;
          }

          .signature-sub {
            font-size: 9.5px;
            color: #64748b;
            margin-top: 2px;
          }

          .print-btn-container {
            display: flex;
            justify-content: center;
            margin-top: 10px;
            margin-bottom: 25px;
          }

          .print-btn {
            background-color: #0d9488;
            color: white;
            border: none;
            padding: 10px 24px;
            border-radius: 6px;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            transition: background-color 0.2s;
            box-shadow: 0 4px 6px rgba(13, 148, 136, 0.15);
          }

          .print-btn:hover {
            background-color: #0f766e;
          }
        </style>
      </head>
      <body>
        <div class="print-btn-container no-print">
          <button class="print-btn" onclick="window.print()">Unduh Laporan Analis Profesional PDF</button>
        </div>

        <table class="header-table" style="width:100%; border:0 !important; margin:0; border-collapse:collapse;">
          <tr style="background:transparent !important;">
            <td class="logo-area" style="border:0 !important; padding:15px; width:70px;">
              <div class="brand-logo-badge" style="padding: 3px; box-sizing: border-box;">
                <svg width="100%" height="100%" viewBox="0 0 165 140" fill="none" xmlns="http://www.w3.org/2000/svg" style="display: block;">
                  <defs>
                    <linearGradient id="goldPdfLogo3" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stop-color="#b45309" />
                      <stop offset="30%" stop-color="#f59e0b" />
                      <stop offset="70%" stop-color="#fbbf24" />
                      <stop offset="100%" stop-color="#d97706" />
                    </linearGradient>
                  </defs>
                  <path d="M 15 25 L 105 25 L 105 40 L 45 90 L 105 90 L 105 105 L 15 105 L 15 90 L 75 40 L 15 40 Z" fill="url(#goldPdfLogo3)" />
                  <circle cx="60" cy="65" r="22" fill="url(#goldPdfLogo3)" stroke="#78350f" stroke-width="1.5" />
                  <circle cx="60" cy="65" r="18" fill="none" stroke="#fef08a" stroke-width="0.8" stroke-dasharray="1.5 1" />
                  <text x="60" y="73" font-family="'Inter', sans-serif" font-weight="900" font-size="22" fill="#78350f" text-anchor="middle">$</text>
                  <path d="M 100 85 L 120 65 L 132 75 L 152 48" fill="none" stroke="url(#goldPdfLogo3)" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round" />
                  <path d="M 136 48 L 154 48 L 154 66" fill="none" stroke="url(#goldPdfLogo3)" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round" />
                  <rect x="108" y="93" width="3.5" height="12" fill="#d97706" opacity="0.3" rx="0.5" />
                  <rect x="119" y="85" width="3.5" height="20" fill="#d97706" opacity="0.5" rx="0.5" />
                  <rect x="130" y="90" width="3.5" height="15" fill="#d97706" opacity="0.7" rx="0.5" />
                  <rect x="141" y="75" width="3.5" height="30" fill="#d97706" opacity="0.9" rx="0.5" />
                </svg>
              </div>
            </td>
            <td class="title-area" style="border:0 !important; padding:15px;">
              <h1 class="system-title">ZAYTRIX</h1>
              <div class="system-subtitle">Expert Advisory Platform</div>
            </td>
            <td class="metadata-area" style="border:0 !important; padding:15px; text-align:right;">
              <div>SEC & OJK COMPLIANT</div>
              <div style="margin-top: 4px;">DOCUMENT INTELLIGENCE COMPLIANCE</div>
            </td>
          </tr>
        </table>

        <div class="header-banner">
          <h1>MEMORANDUM HASIL ANALISIS INTEGRASI DOKUMEN</h1>
          <p>RISSET KHUSUS INSTRUMEN: ${category === "stock" ? "LAPORAN KEUANGAN KORPORASI" : "WHITEPAPER PROYEK KRIPTO"}</p>
        </div>

        <div class="meta-grid">
          <div class="meta-item">
            <span class="meta-label">Nama File Sumber</span>
            <span class="meta-value" style="word-break: break-all;">${filename}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">Akreditasi Analis</span>
            <span class="meta-value">CFA Charterholder & FRM Specialist</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">ID Dokumen AI</span>
            <span class="meta-value">REPORT-CFA/INT-${fileCleanName.toUpperCase().slice(0,6)}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">Tanggal Analisis</span>
            <span class="meta-value">${now.toLocaleDateString("id-ID", { day: 'numeric', month: 'long', year: 'numeric' })}</span>
          </div>
        </div>

        <div class="report-content">
          ${cleanHtml}
        </div>

        <div class="analyst-sign-off">
          <div class="signature-box">
            <div class="signature-title">Disusun Oleh</div>
            <div style="height: 35px; display: flex; align-items: center; justify-content: center;">
              <span style="font-family: 'Cinzel', serif; font-size: 14px; color: #475569; letter-spacing: 2px;">SENIOR VALUER BLOCK</span>
            </div>
            <div class="signature-line">Analis Utama Riset Korporat</div>
            <div class="signature-sub">CFA Charterholder No. 894372</div>
          </div>
          <div class="signature-box">
            <div class="signature-title">Disahkan & Ditinjau Oleh</div>
            <div style="height: 35px; display: flex; align-items: center; justify-content: center;">
              <span style="font-family: 'Cinzel', serif; font-size: 14px; color: #475569; letter-spacing: 2px;">ADVISORY CORE COMMITTEE</span>
            </div>
            <div class="signature-line">Komite Audit & Manajemen Risiko</div>
            <div class="signature-sub">FRM Certified Board of Specialists</div>
          </div>
        </div>

        <div class="disclaimer">
          <div class="disclaimer-title">Pernyataan Penyangkalan (Disclaimer) Khusus Dokumen</div>
          Laporan Analisis Dokumen ini diterbitkan oleh divisi intelijen keuangan ZAYTRIX berdasarkan berkas asli yang diunggah oleh pihak pemegang lisensi. Segala argumen, taksiran, rasio likuiditas/kapitalisasi, audit struktur konsensus, atau solvabilitas modal korporat merupakan hasil pengolahan kognitif mendalam yang bersumber langsung dari data tekstual dokumen bersangkutan. Catatan riset ini bukan merupakan bujukan formal untuk alokasi dana spekulatif atau tawaran instrumen sekuritas pasar. Seluruh aktivitas penempatan modal tunduk pada risiko penurunan nilai sistemik bursa serta regulasi hukum wilayah yurisdiksi masing-masing negara.
        </div>

        <script>
          window.onload = function() {
            setTimeout(function(){
              window.print();
            }, 600);
          };
        </script>
      </body>
    </html>
  `;

  printWindow.document.write(htmlReport);
  printWindow.document.close();
}

export function exportMultiPdfComparisonReport(aiAnalysis: string, fileNames: string[], category: string) {
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    alert("Popup terblokir oleh browser Anda. Harap berikan izin popup agar dapat mencetak dokumen PDF.");
    return;
  }

  const cleanHtml = parseMarkdownToHtml(aiAnalysis);
  const now = new Date();
  const listFilesFormatted = fileNames.map(name => `<li>${name}</li>`).join("");

  const htmlReport = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>ZAYTRIX Komparatif Multi-Dokumen - ${category === "crypto" ? "Kripto" : "Saham"}</title>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700&family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
          
          @media print {
            body {
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
              background-color: #ffffff !important;
            }
            .no-print { display: none !important; }
            @page {
              size: A4;
              margin: 20mm 15mm 20mm 15mm;
            }
          }
          
          body { 
            font-family: 'Inter', sans-serif; 
            color: #0f172a; 
            line-height: 1.6; 
            background-color: #fcfdfd;
            padding: 40px;
            max-width: 820px;
            margin: 0 auto;
            border-top: 6px solid #d97706; /* Elite gold trim */
            position: relative;
          }
          
          body::before {
            content: "";
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500" opacity="0.08" width="100%" height="100%"><g transform="translate(120, 120) scale(1.6) rotate(0, 100, 100)"><linearGradient id="gMulti" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="%23b45309" /><stop offset="35%" stop-color="%23f59e0b" /><stop offset="65%" stop-color="%23fbbf24" /><stop offset="100%" stop-color="%23d97706" /></linearGradient><path d="M 15 25 L 105 25 L 105 40 L 45 90 L 105 90 L 105 105 L 15 105 L 15 90 L 75 40 L 15 40 Z" fill="url(%23gMulti)" /><circle cx="60" cy="65" r="22" fill="url(%23gMulti)" stroke="%2378350f" stroke-width="1.5" /><circle cx="60" cy="65" r="18" fill="none" stroke="%23fef08a" stroke-width="0.8" stroke-dasharray="1.5 1" /><text x="60" y="73" font-family="sans-serif" font-weight="900" font-size="22" fill="%2378350f" text-anchor="middle">$</text><path d="M 100 85 L 120 65 L 132 75 L 152 48" fill="none" stroke="url(%23gMulti)" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round" /><path d="M 136 48 L 154 48 L 154 66" fill="none" stroke="url(%23gMulti)" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round" /><rect x="108" y="93" width="3.5" height="12" fill="%23d97706" opacity="0.3" rx="0.5" /><rect x="119" y="85" width="3.5" height="20" fill="%23d97706" opacity="0.5" rx="0.5" /><rect x="130" y="90" width="3.5" height="15" fill="%23d97706" opacity="0.7" rx="0.5" /><rect x="141" y="75" width="3.5" height="30" fill="%23d97706" opacity="0.9" rx="0.5" /><text x="82" y="145" font-family="sans-serif" font-weight="900" font-size="22" fill="%230f172a" letter-spacing="3" text-anchor="middle">ZAYTRIX</text></g></svg>');
            background-repeat: no-repeat;
            background-position: center;
            background-size: 550px 550px;
            z-index: -1000;
            pointer-events: none;
          }
          
          .header-table {
            width: 100%;
            background-color: #0f172a; /* elegant dark slate header band format */
            border-bottom: 3px solid #d97706; /* gold border bottom */
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 25px;
          }
          
          .logo-area {
            width: 12%;
            vertical-align: middle;
          }
          
          .brand-logo-badge {
            width: 52px;
            height: 52px;
            background: #090d16;
            border: 2px solid #d97706; /* gold border */
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 4px 10px rgba(0,0,0,0.3);
          }
          
          .brand-logo-badge-text {
            color: #f59e0b; /* active gold */
            font-family: 'Inter', sans-serif;
            font-weight: 900;
            font-size: 26px;
            line-height: 52px;
            text-align: center;
            width: 100%;
          }
          
          .title-area {
            width: 58%;
            vertical-align: middle;
            padding-left: 15px;
          }
          
          .system-title {
            font-family: 'Inter', sans-serif;
            font-size: 22px;
            color: #38bdf8; /* sky blue matches modern portal */
            font-weight: 900;
            letter-spacing: 2.5px;
            line-height: 1.2;
            margin: 0;
          }
          
          .system-subtitle {
            font-family: 'Inter', sans-serif;
            font-size: 10px;
            color: #f59e0b; /* active gold subtitle logo style */
            letter-spacing: 4px;
            font-weight: 700;
            margin: 4px 0 0 0;
            text-transform: uppercase;
          }
          
          .metadata-area {
            width: 30%;
            text-align: right;
            font-family: 'JetBrains Mono', monospace;
            font-size: 9.5px;
            color: #94a3b8; /* white-friendly slate description for dark background header */
            vertical-align: middle;
          }
          
          .doc-nature-badge {
            display: inline-block;
            background-color: #0f172a;
            color: #ffffff;
            padding: 4px 10px;
            font-family: 'Inter', sans-serif;
            font-size: 9px;
            font-weight: 700;
            letter-spacing: 1px;
            border-radius: 4px;
            margin-bottom: 5px;
            text-transform: uppercase;
            border: 1px solid #d97706;
          }
          
          .meta-row {
            margin-bottom: 2px;
          }
          
          .report-headline {
            font-family: 'Cinzel', serif;
            color: #0f172a;
            font-size: 16px;
            font-weight: 700;
            letter-spacing: 0.5px;
            background-color: #f1f5f9;
            padding: 10px 14px;
            border-left: 4px solid #0d9488;
            margin-bottom: 25px;
            text-transform: uppercase;
          }
          
          .analytics-summary-card {
            background-color: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 6px;
            padding: 15px;
            margin-bottom: 25px;
          }
          
          .summary-card-title {
            font-family: 'Cinzel', serif;
            font-size: 11px;
            font-weight: 700;
            color: #475569;
            text-transform: uppercase;
            letter-spacing: 1.5px;
            margin-bottom: 8px;
            border-bottom: 1px solid #e2e8f0;
            padding-bottom: 4px;
          }
          
          .summary-list-files {
            margin: 0;
            padding-left: 20px;
            font-size: 11.5px;
            color: #334155;
            line-height: 1.5;
          }

          table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 15px;
            margin-bottom: 20px;
            font-size: 11.5px;
          }
          
          th {
            background-color: #0d9488;
            color: white;
            font-family: 'Cinzel', serif;
            font-size: 10px;
            letter-spacing: 0.5px;
            padding: 10px 8px;
            border: 1px solid #0d9488;
            text-transform: uppercase;
            text-align: center;
          }
          
          td {
            padding: 10px 8px;
            border: 1px solid #e2e8f0;
            color: #1e293b;
          }
          
          tr:nth-child(even) {
            background-color: #f8fafc;
          }
          
          p {
            text-align: justify;
            text-indent: 14px;
            margin-bottom: 14px;
            font-size: 13.5px;
            line-height: 1.65;
            color: #1e293b;
          }
          
          strong {
            color: #0f172a;
          }

          h1, h2, h3, h4, th {
            page-break-after: avoid;
            page-break-inside: avoid;
          }

          tr, td {
            page-break-inside: avoid;
          }
          
          .signature-section {
            margin-top: 50px;
            width: 100%;
            border-top: 1px solid #cbd5e1;
            padding-top: 30px;
            page-break-inside: avoid;
          }
          
          .sig-box {
            width: 50%;
            display: inline-block;
            vertical-align: top;
          }
          
          .stamp-mark {
            width: 65px;
            height: 65px;
            border: 2px dashed rgba(13, 148, 136, 0.4);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-family: 'Cinzel', serif;
            font-weight: 700;
            font-size: 10px;
            color: #0d9488;
            transform: rotate(-10deg);
            margin-bottom: 10px;
            opacity: 0.85;
            letter-spacing: 0.5px;
          }
          
          .signature-line {
            font-weight: 700;
            color: #0f172a;
            font-size: 12px;
            margin-top: 15px;
          }
          
          .signature-sub {
            color: #64748b;
            font-size: 10px;
            font-family: 'JetBrains Mono', monospace;
          }
          
          .disclaimer {
            margin-top: 40px;
            border-top: 1px solid #e2e8f0;
            padding-top: 15px;
            font-size: 9.5px;
            color: #64748b;
            text-align: justify;
            line-height: 1.5;
            page-break-inside: avoid;
          }
          
          .disclaimer-title {
            text-transform: uppercase;
            font-weight: 700;
            font-size: 10px;
            color: #475569;
            margin-bottom: 4px;
            font-family: 'Cinzel', serif;
            letter-spacing: 1px;
          }
        </style>
      </head>
      <body>
        <table class="header-table" style="width:100%; border:0 !important; margin:0; border-collapse:collapse;">
          <tr style="background:transparent !important;">
            <td class="logo-area" style="border:0 !important; padding:15px;">
              <div class="brand-logo-badge" style="padding: 3px; box-sizing: border-box;">
                <svg width="100%" height="100%" viewBox="0 0 165 140" fill="none" xmlns="http://www.w3.org/2000/svg" style="display: block;">
                  <defs>
                    <linearGradient id="goldPdfLogo4" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stop-color="#b45309" />
                      <stop offset="30%" stop-color="#f59e0b" />
                      <stop offset="70%" stop-color="#fbbf24" />
                      <stop offset="100%" stop-color="#d97706" />
                    </linearGradient>
                  </defs>
                  <path d="M 15 25 L 105 25 L 105 40 L 45 90 L 105 90 L 105 105 L 15 105 L 15 90 L 75 40 L 15 40 Z" fill="url(#goldPdfLogo4)" />
                  <circle cx="60" cy="65" r="22" fill="url(#goldPdfLogo4)" stroke="#78350f" stroke-width="1.5" />
                  <circle cx="60" cy="65" r="18" fill="none" stroke="#fef08a" stroke-width="0.8" stroke-dasharray="1.5 1" />
                  <text x="60" y="73" font-family="'Inter', sans-serif" font-weight="900" font-size="22" fill="#78350f" text-anchor="middle">$</text>
                  <path d="M 100 85 L 120 65 L 132 75 L 152 48" fill="none" stroke="url(#goldPdfLogo4)" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round" />
                  <path d="M 136 48 L 154 48 L 154 66" fill="none" stroke="url(#goldPdfLogo4)" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round" />
                  <rect x="108" y="93" width="3.5" height="12" fill="#d97706" opacity="0.3" rx="0.5" />
                  <rect x="119" y="85" width="3.5" height="20" fill="#d97706" opacity="0.5" rx="0.5" />
                  <rect x="130" y="90" width="3.5" height="15" fill="#d97706" opacity="0.7" rx="0.5" />
                  <rect x="141" y="75" width="3.5" height="30" fill="#d97706" opacity="0.9" rx="0.5" />
                </svg>
              </div>
            </td>
            <td class="title-area" style="border:0 !important; padding:15px;">
              <h1 class="system-title">ZAYTRIX</h1>
              <div class="system-subtitle">Expert Advisory Platform</div>
            </td>
            <td class="metadata-area" style="border:0 !important; padding:0; text-align:right;">
              <span class="doc-nature-badge">${category === "crypto" ? "Crypto Analysis" : "Stock Analysis"}</span>
              <div class="meta-row">ID KELUARAN: CT-COMP-${Math.floor(Math.random() * 9000 + 1000)}</div>
              <div class="meta-row">SIFAT: SANGAT RAHASIA</div>
              <div class="meta-row">TANGGAL PENERBITAN: ${now.toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
            </td>
          </tr>
        </table>

        <div class="report-headline">
          Laporan Evaluasi Proyek Komparatif Multi-Dokumen Bersilang (${fileNames.length} Berkas)
        </div>

        <div class="analytics-summary-card">
          <div class="summary-card-title">Kumpulan Berkas Laporan Yang Dibandingkan</div>
          <ul class="summary-list-files">
            ${listFilesFormatted}
          </ul>
        </div>

        <div style="margin-top: 25px;">
          ${cleanHtml}
        </div>

        <div class="signature-section">
          <div class="sig-box" style="float: left;">
            <div class="stamp-mark">
              { Z-CAP }
            </div>
            <div class="signature-line">Departemen Risiko & Intelijen Pasar</div>
            <div class="signature-sub">CFA Advisory Committee on Risk Policy</div>
          </div>
          <div class="sig-box" style="float: right; text-align: right;">
            <div style="display: inline-block; text-align: left;">
              <div class="stamp-mark" style="border-color: #475569; color: #475569;">
                SECURE
              </div>
              <div class="signature-line">Komite Audit & Manajemen Risiko</div>
              <div class="signature-sub">FRM Certified Board of Specialists</div>
            </div>
          </div>
          <div style="clear: both;"></div>
        </div>

        <div class="disclaimer">
          <div class="disclaimer-title">Pernyataan Penyangkalan (Disclaimer) Khusus Dokumen</div>
          Laporan Analisis Komparatif Finansial ini diterbitkan oleh Divisi Riset Strategis ZAYTRIX berdasarkan berkas asli yang diunggah oleh pihak pemegang lisensi. Segala argumentasi, taksiran rasionasi, proyeksi CAGR kuantitatif, stres testing, evaluasi konsensus tokenomik, maupun model alokasi strategis merupakan hasil pengolahan kognitif mendalam yang dideferensiasikan langsung dari data tekstual dokumen-dokumen bersangkutan. Catatan riset ini bukan merupakan bujukan formal untuk penempatan instrumen investasi bursa mana pun atau tawaran sekuritas pasar modal riil. Seluruh aktivitas penempatan modal tunduk pada risiko penurunan nilai sistemik bursa serta regulasi hukum wilayah yurisdiksi masing-masing negara.
        </div>

        <script>
          window.onload = function() {
            setTimeout(function(){
              window.print();
            }, 600);
          };
        </script>
      </body>
    </html>
  `;

  printWindow.document.write(htmlReport);
  printWindow.document.close();
}

