/**
 * ==============================================================================
 * MIX MATEUS — GERADOR DE CRACHÁS DE INVENTÁRIO PRO
 * Desenvolvido por: Felipe Samack (Samack D697)
 * Copyright (c) 2026 Felipe Samack. Todos os direitos reservados.
 * 
 * AVISO DE PROPRIEDADE INTELECTUAL & LICENÇA COMERCIAL:
 * Este software, método de diagramação e código-fonte são protegidos pelas
 * Leis Federais nº 9.609/98 e nº 9.610/98 e Código Penal Brasileiro.
 * O uso é estritamente pessoal e não comercial.
 * VEDADO O USO, CÓPIA, ENGENHARIA REVERSA OU INTEGRAÇÃO POR EMPRESAS SEM
 * PRÉVIA LICENÇA COMERCIAL.
 * 
 * Contato Oficial para Licenciamento Corporativo & Negociação Comercial:
 * E-mail: felipesamackofficial@gmail.com
 * ==============================================================================
 */

const SUPABASE_URL = "https://euvhtrwbyxjezbwwwbxb.supabase.co";
const SUPABASE_KEY = "sb_publishable_C_hnCysx4ulNklCJv0UO9g_YFGMgyBv";

const supabaseClient = (typeof window.supabase !== "undefined")
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY)
    : null;

let rawItems = [];
let currentPdfBlobUrl = null;
let isMixBlocked = false;
let lastBlockMessage = "";
let initialTelemetriaEnviada = false;
let currentLoja = "—";
let currentFilename = "";
let realtimeChannel = null;

document.addEventListener("DOMContentLoaded", () => {
    configurarDragAndDrop();
    configurarEventos();
    ativarProtecaoAntiCopia();
    verificarAcessoSupabase(true);
    configurarSupabaseRealtime();

    // Heartbeat de segurança em tempo real a cada 10s como redundância ativa
    setInterval(() => {
        if (!isMixBlocked) {
            verificarAcessoSupabase(false);
        }
    }, 10000);
});

// --- TELEMETRIA & SEGURANÇA ---
function obterInfoDispositivo() {
    const ua = navigator.userAgent || "";
    let osName = "Desconhecido";
    if (/Windows/i.test(ua)) osName = "Windows";
    else if (/Android/i.test(ua)) osName = "Android";
    else if (/iPhone|iPad|iPod/i.test(ua)) osName = "iOS";
    else if (/Mac OS/i.test(ua)) osName = "macOS";
    else if (/Linux/i.test(ua)) osName = "Linux";

    const isTouch = ("ontouchstart" in window) || (navigator.maxTouchPoints > 0);
    const screenW = window.screen.width;
    const screenH = window.screen.height;
    const vpW = window.innerWidth;
    let deviceType = "Desktop";
    if (/Mobi|Android|iPhone/i.test(ua) || (isTouch && vpW < 768)) {
        deviceType = "Mobile";
    } else if (/iPad|Tablet/i.test(ua) || (isTouch && vpW >= 768 && vpW <= 1024)) {
        deviceType = "Tablet";
    }

    return {
        osName,
        deviceType,
        isTouch,
        resolution: `${screenW}x${screenH}`,
        viewport: `${vpW}x${window.innerHeight}`,
        userAgent: ua
    };
}

function ativarProtecaoAntiCopia() {
    // 1. Bloqueia botão direito
    document.addEventListener("contextmenu", e => e.preventDefault());

    // 2. Bloqueia atalhos de desenvolvedor, inspeção, salvamento de página e código fonte
    document.addEventListener("keydown", e => {
        const k = (e.key || "").toUpperCase();
        const isCtrl = e.ctrlKey || e.metaKey;
        const isShift = e.shiftKey;

        if (
            k === "F12" ||
            (isCtrl && isShift && ["I", "J", "C"].includes(k)) ||
            (isCtrl && ["U", "S", "P"].includes(k))
        ) {
            e.preventDefault();
            e.stopPropagation();
            return false;
        }
    });

    // 3. Bloqueia arrasto de imagens e elementos para inspeção
    document.addEventListener("dragstart", e => {
        if (e.target && (e.target.tagName === "IMG" || e.target.tagName === "A")) {
            e.preventDefault();
        }
    });

    // 4. Detecção ativa de abertura de DevTools (trava por debugger)
    setInterval(() => {
        const threshold = 160;
        const widthDiff = window.outerWidth - window.innerWidth > threshold;
        const heightDiff = window.outerHeight - window.innerHeight > threshold;
        if (widthDiff || heightDiff) {
            try {
                const trap = Function("debugger");
                trap();
            } catch (err) {}
        }
    }, 1500);
}

/**
 * Validação de Licença Remota (Kill-Switch) + Telemetria em Tempo Real no Supabase
 * @param {boolean} mostrarAlerta Se true, exibe o popup nativo de aviso
 * @returns {Promise<boolean>} true se o acesso estiver liberado, false se bloqueado
 */
async function verificarAcessoSupabase(mostrarAlerta = true) {
    try {
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), 3500);
        
        // Consulta em paralelo a trava do Mix Mateus e a trava Global
        const url = `${SUPABASE_URL}/rest/v1/controle_acesso?or=(app_name.eq.mix_mateus,app_name.eq.global)&select=*`;
        const res = await fetch(url, {
            headers: {
                "apikey": SUPABASE_KEY,
                "Authorization": `Bearer ${SUPABASE_KEY}`
            },
            signal: ctrl.signal
        });
        clearTimeout(tid);

        let configBloqueio = null;

        if (res.ok) {
            const rows = await res.json();
            if (Array.isArray(rows) && rows.length > 0) {
                const mixRow = rows.find(r => r.app_name === "mix_mateus");
                const globalRow = rows.find(r => r.app_name === "global");

                // Se Mix Mateus OU Global estiver desativado pelo administrador
                if (mixRow && mixRow.sistema_ativo === false) {
                    configBloqueio = mixRow;
                } else if (globalRow && globalRow.sistema_ativo === false) {
                    configBloqueio = globalRow;
                }
            }
        }

        // Se bloqueado pelo administrador
        if (configBloqueio) {
            const msg = configBloqueio.mensagem_bloqueio || "Aplicativo desativado pela administração (Samack 697).";
            isMixBlocked = true;
            lastBlockMessage = msg;
            rawItems = [];

            // 1. Atualiza imediatamente o DOM para a tela de bloqueio com cadeado vermelho
            document.body.innerHTML = `
                <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:100vh; background:#0b0f19; color:#f8fafc; font-family:'Inter',sans-serif; text-align:center; padding:24px; box-sizing:border-box;">
                    <div style="font-size:3.5rem; margin-bottom:1rem; filter:drop-shadow(0 0 16px rgba(239, 68, 68, 0.5));">🔒</div>
                    <h1 style="font-size:1.8rem; color:#ef4444; margin-bottom:12px; font-weight:800; letter-spacing:-0.5px;">Acesso Suspenso pelo Administrador</h1>
                    <p style="font-size:1.05rem; color:#94a3b8; max-width:520px; line-height:1.6; margin-bottom:1.5rem;">
                        ${msg}
                    </p>
                    <div style="padding:10px 18px; background:rgba(239, 68, 68, 0.1); border:1px solid rgba(239, 68, 68, 0.3); border-radius:8px; font-family:monospace; font-size:0.82rem; color:#fca5a5; margin-bottom:2rem;">
                        STATUS: BLOQUEADO (KILL-SWITCH ATIVO NO SUPABASE)
                    </div>
                    <div style="font-size:0.85rem; color:#64748b; border-top:1px solid rgba(255, 255, 255, 0.08); padding-top:1.5rem; max-width:400px;">
                        Mix Mateus • Inventário D697 • by Samack 697<br>
                        Contato: <a href="mailto:felipesamackofficial@gmail.com" style="color:#38bdf8; text-decoration:none;">felipesamackofficial@gmail.com</a>
                    </div>
                </div>
            `;

            // 2. Dispara o alerta nativo se solicitado
            if (mostrarAlerta) {
                try {
                    alert("🔴 ACESSO SUSPENSO: " + msg);
                } catch (e) {}
            }

            // Registra tentativa bloqueada
            obterGeolocalizacaoWeb().then(geo => {
                const info = obterInfoDispositivo();
                const hwid = "WEB-" + btoa(info.userAgent + info.resolution).substring(0, 16);
                fetch(`${SUPABASE_URL}/rest/v1/logs_acesso`, {
                    method: "POST",
                    headers: {
                        "apikey": SUPABASE_KEY,
                        "Authorization": `Bearer ${SUPABASE_KEY}`,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify([{
                        data_hora: new Date().toISOString(),
                        nome_pc: `${info.deviceType} (${info.osName})`,
                        usuario_win: `Disp: ${info.deviceType} [${info.resolution}]`,
                        os_info: info.userAgent.substring(0, 100),
                        hwid: hwid,
                        ip_publico: geo.ip || "Desconhecido",
                        cidade: geo.cidade || "Desconhecida",
                        estado: geo.estado || "—",
                        pais: geo.pais || "Brasil",
                        provedor: geo.provedor || "—",
                        status: "BLOQUEADO",
                        app_name: "mix_mateus",
                        acao: "Tentativa Bloqueada",
                        detalhes_geracao: `https://rgis-samack.github.io/mixmateus/ | Viewport: ${info.viewport}`
                    }])
                }).catch(() => {});
            });

            return false;
        }

        // Acesso Liberado
        isMixBlocked = false;

        // Registra acesso inicial liberado uma vez por sessão
        if (!initialTelemetriaEnviada) {
            initialTelemetriaEnviada = true;
            obterGeolocalizacaoWeb().then(geo => {
                const info = obterInfoDispositivo();
                const hwid = "WEB-" + btoa(info.userAgent + info.resolution).substring(0, 16);
                fetch(`${SUPABASE_URL}/rest/v1/logs_acesso`, {
                    method: "POST",
                    headers: {
                        "apikey": SUPABASE_KEY,
                        "Authorization": `Bearer ${SUPABASE_KEY}`,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify([{
                        data_hora: new Date().toISOString(),
                        nome_pc: `${info.deviceType} (${info.osName})`,
                        usuario_win: `Disp: ${info.deviceType} [${info.resolution}]`,
                        os_info: info.userAgent.substring(0, 100),
                        hwid: hwid,
                        ip_publico: geo.ip || "Desconhecido",
                        cidade: geo.cidade || "Desconhecida",
                        estado: geo.estado || "—",
                        pais: geo.pais || "Brasil",
                        provedor: geo.provedor || "—",
                        status: "LIBERADO",
                        app_name: "mix_mateus",
                        acao: "Acesso Mix Mateus Web",
                        detalhes_geracao: `https://rgis-samack.github.io/mixmateus/ | Viewport: ${info.viewport}`
                    }])
                }).catch(() => {});
            });
        }

        return true;

    } catch (err) {
        console.warn("Aviso na verificação de acesso:", err);
        return true;
    }
}

// --- SUPABASE REALTIME: BLOQUEIO & DESBLOQUEIO INSTANTÂNEO (WEBSOCKET) ---
function configurarSupabaseRealtime() {
    if (!supabaseClient) return;
    try {
        if (realtimeChannel) {
            supabaseClient.removeChannel(realtimeChannel);
        }

        realtimeChannel = supabaseClient
            .channel("realtime_mix_controle_acesso")
            .on(
                "postgres_changes",
                {
                    event: "*",
                    schema: "public",
                    table: "controle_acesso"
                },
                payload => {
                    const row = payload.new || payload.old;
                    if (!row) return;

                    console.log("⚡ [Realtime Supabase] Mudança instantânea detectada:", row.app_name, "sistema_ativo =", row.sistema_ativo);

                    if (row.app_name === "mix_mateus" || row.app_name === "global") {
                        if (row.sistema_ativo === false) {
                            // Bloqueio imediato!
                            verificarAcessoSupabase(true);
                        } else if (isMixBlocked && row.sistema_ativo === true) {
                            // Desbloqueio instantâneo automático
                            isMixBlocked = false;
                            window.location.reload();
                        }
                    }
                }
            )
            .subscribe((status) => {
                if (status === "SUBSCRIBED") {
                    console.log("⚡ [Realtime Supabase] Canal conectado e ouvindo alterações instantâneas em 'controle_acesso'.");
                }
            });
    } catch (err) {
        console.warn("Aviso ao ativar Supabase Realtime:", err);
    }
}

// --- MÉTRICAS DE PRODUTIVIDADE EM TEMPO REAL ---
function registrarMetricaProdutividade(acaoNome, qtdCrachas, qtdItens, qtdAreas) {
    if (!supabaseClient || isMixBlocked) return;
    try {
        const info = obterInfoDispositivo();
        obterGeolocalizacaoWeb().then(geo => {
            const hwid = "WEB-" + btoa(info.userAgent + info.resolution).substring(0, 16);
            const lojaIdentificada = (currentLoja && currentLoja !== "—") ? `Loja ${currentLoja}` : "Loja Indefinida";
            const detalhes = `${lojaIdentificada} | Crachás: ${qtdCrachas} | Itens: ${qtdItens} | Áreas: ${qtdAreas} | Arquivo: ${currentFilename || "—"} | Viewport: ${info.viewport}`;

            supabaseClient.from("logs_acesso").insert([{
                data_hora: new Date().toISOString(),
                nome_pc: `${info.deviceType} (${info.osName})`,
                usuario_win: `Disp: ${info.deviceType} [${info.resolution}]`,
                os_info: info.userAgent.substring(0, 100),
                hwid: hwid,
                ip_publico: geo.ip || "Desconhecido",
                cidade: geo.cidade || "Desconhecida",
                estado: geo.estado || "—",
                pais: geo.pais || "Brasil",
                provedor: geo.provedor || "—",
                status: "LIBERADO",
                app_name: "mix_mateus",
                acao: acaoNome,
                detalhes_geracao: detalhes
            }]).then(() => {
                console.log("📊 [Métrica Supabase] Produtividade registrada com sucesso:", detalhes);
            });
        });
    } catch (e) {
        console.warn("Aviso ao registrar métrica de produtividade:", e);
    }
}

async function obterGeolocalizacaoWeb() {
    const padrao = { ip: "Desconhecido", cidade: "Desconhecida", estado: "—", pais: "Brasil", provedor: "—" };
    try {
        const ctrl = new AbortController();
        const tId = setTimeout(() => ctrl.abort(), 2500);
        const res = await fetch("https://ipwho.is/", { signal: ctrl.signal });
        clearTimeout(tId);
        if (res.ok) {
            const d = await res.json();
            if (d && d.success !== false && d.ip) {
                return {
                    ip: d.ip,
                    cidade: d.city || padrao.cidade,
                    estado: d.region_code || padrao.estado,
                    pais: d.country || padrao.pais,
                    provedor: (d.connection && (d.connection.isp || d.connection.org)) || "—"
                };
            }
        }
    } catch (e) {}

    try {
        const res = await fetch("https://api.ipify.org?format=json");
        if (res.ok) {
            padrao.ip = (await res.json()).ip || padrao.ip;
        }
    } catch (e) {}

    return padrao;
}

// --- DRAG AND DROP & INPUT DE ARQUIVO ---
function configurarDragAndDrop() {
    const overlay = document.getElementById("drag-overlay");
    window.addEventListener("dragover", e => {
        e.preventDefault();
        overlay.classList.add("active");
    });
    window.addEventListener("dragleave", e => {
        if (e.relatedTarget === null) {
            overlay.classList.remove("active");
        }
    });
    window.addEventListener("drop", e => {
        e.preventDefault();
        overlay.classList.remove("active");
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            processarArquivo(e.dataTransfer.files[0]);
        }
    });
}

function configurarEventos() {
    const btnSelect = document.getElementById("btn-file-select");
    const fileInput = document.getElementById("file-input");

    btnSelect?.addEventListener("click", () => fileInput?.click());
    fileInput?.addEventListener("change", e => {
        if (e.target.files && e.target.files.length > 0) {
            processarArquivo(e.target.files[0]);
        }
    });

    document.getElementById("btn-gerar-mix")?.addEventListener("click", () => gerarPdfMixMateus());
    document.getElementById("input-inicio")?.addEventListener("input", atualizarListaFiltrada);
    document.getElementById("input-fim")?.addEventListener("input", atualizarListaFiltrada);

    // Modal de Termos de Uso & Licença Comercial
    const modalTermos = document.getElementById("modal-termos");
    const btnAbrirTermos = document.getElementById("btn-abrir-termos");
    const btnFecharTermos = document.getElementById("btn-fechar-termos");
    const btnEntendiTermos = document.getElementById("btn-entendi-termos");

    const abrirModal = () => {
        if (modalTermos) modalTermos.classList.add("active");
    };
    const fecharModal = () => {
        if (modalTermos) modalTermos.classList.remove("active");
    };

    btnAbrirTermos?.addEventListener("click", abrirModal);
    btnFecharTermos?.addEventListener("click", fecharModal);
    btnEntendiTermos?.addEventListener("click", fecharModal);

    modalTermos?.addEventListener("click", e => {
        if (e.target === modalTermos) fecharModal();
    });

    document.addEventListener("keydown", e => {
        if (e.key === "Escape" && modalTermos?.classList.contains("active")) {
            fecharModal();
        }
    });
}

// --- PROCESSAMENTO DE ARQUIVOS (CSV / EXCEL) ---
async function processarArquivo(file) {
    if (isMixBlocked) {
        alert("🔴 ACESSO SUSPENSO: " + (lastBlockMessage || "Aplicativo desativado pela administração (Samack 697)."));
        return;
    }

    // Validação ativa em tempo real contra o Supabase antes de processar o arquivo
    const liberado = await verificarAcessoSupabase(false);
    if (!liberado) {
        alert("🔴 ACESSO SUSPENSO: " + (lastBlockMessage || "Aplicativo desativado pela administração (Samack 697)."));
        return;
    }

    const reader = new FileReader();
    const isCsv = file.name.toLowerCase().endsWith(".csv");

    reader.onload = e => {
        try {
            let sheetData = [];
            if (isCsv) {
                const dec = new TextDecoder("utf-8");
                const text = dec.decode(e.target.result);
                sheetData = parseCsvText(text);
            } else {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: "array" });
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                sheetData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });
            }

            processarLinhasFormatadas(sheetData, file.name);
        } catch (err) {
            alert("Erro ao ler o arquivo: " + err.message);
        }
    };

    reader.readAsArrayBuffer(file);
}

function parseCsvText(csv) {
    const lines = csv.split(/\r\n|\n/);
    if (!lines.length) return [];
    const firstLine = lines[0];
    const sep = firstLine.includes(";") ? ";" : (firstLine.includes("\t") ? "\t" : ",");
    const result = [];
    for (let line of lines) {
        if (!line.trim()) continue;
        const row = line.split(sep).map(c => c.replace(/^["']|["']$/g, "").trim());
        result.push(row);
    }
    return result;
}

function normStr(str) {
    if (str === null || str === undefined) return "";
    return String(str).trim().toLowerCase();
}

function formatarDataContagem(dataStr) {
    if (!dataStr) return "";
    let s = String(dataStr).trim();
    if (!s) return "";
    if (s.includes(" / ")) return s;
    const m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
    if (m) {
        return `${m[1].padStart(2, "0")} / ${m[2].padStart(2, "0")} /${m[3]}`;
    }
    const mIso = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (mIso) {
        return `${mIso[3].padStart(2, "0")} / ${mIso[2].padStart(2, "0")} /${mIso[1]}`;
    }
    return s;
}

function limparZerosEsquerda(val) {
    if (!val && val !== 0) return "";
    const s = String(val).trim();
    if (!s) return "";
    const clean = s.replace(/^0+/, "");
    return clean || "0";
}

function formatarQuantidade(val) {
    if (val === null || val === undefined || val === "") return "0";
    let s = String(val).trim();
    if (!s) return "0";
    if (s.endsWith(".000") || s.endsWith(",000")) {
        s = s.slice(0, -4);
    } else if (s.endsWith(".00") || s.endsWith(",00")) {
        s = s.slice(0, -3);
    }
    return s || "0";
}

function processarLinhasFormatadas(rows, fileName) {
    if (!rows || rows.length < 2) {
        alert("Arquivo sem dados ou formato inválido.");
        return;
    }

    currentFilename = fileName || "";
    // Detecta número da loja a partir do nome do arquivo (ex: Consolidado_506.csv -> 506)
    const matchLoja = (fileName || "").match(/(\d{3,5})/);
    if (matchLoja) {
        currentLoja = matchLoja[1];
    }

    const header = rows[0].map(h => normStr(h));
    const colPatterns = {
        area: ["area", "área", "secao", "setor"],
        sku: ["codinterno", "cod_interno", "sku", "codigo_interno", "reduzido"],
        barcode: ["codbarras", "cod_barras", "barcode", "codigo_barras", "ean"],
        descricao: ["descricao", "descrição", "produto", "nome"],
        quantidade: ["qtd", "quantidade", "quant"],
        data_contagem: ["datacontagem", "data_contagem", "data contagem", "data"],
        loja: ["loja"]
    };

    const colIndices = {};
    for (let key in colPatterns) {
        let idx = -1;
        for (let pat of colPatterns[key]) {
            idx = header.findIndex(h => h.includes(pat));
            if (idx !== -1) break;
        }
        colIndices[key] = idx;
    }

    // Fallbacks padrão caso não encontre por nome
    if (colIndices.area === -1) colIndices.area = 2;
    if (colIndices.sku === -1) colIndices.sku = 4;
    if (colIndices.barcode === -1) colIndices.barcode = 3;
    if (colIndices.descricao === -1) colIndices.descricao = 5;
    if (colIndices.quantidade === -1) colIndices.quantidade = 7;
    if (colIndices.data_contagem === -1) colIndices.data_contagem = 8;
    if (colIndices.loja === -1) colIndices.loja = 0;

    const dataRows = rows.slice(1).filter(r => r && r.length > 0 && r[colIndices.area] !== "");

    // Ordenação numérica por área
    dataRows.sort((a, b) => {
        const aArea = String(a[colIndices.area] || "").trim();
        const bArea = String(b[colIndices.area] || "").trim();
        const numA = parseInt(aArea, 10);
        const numB = parseInt(bArea, 10);
        if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
        return aArea.localeCompare(bArea);
    });

    rawItems = [];
    dataRows.forEach(r => {
        const area = String(r[colIndices.area] || "").trim();
        if (!area) return;

        const skuRaw = String(r[colIndices.sku] || "").trim();
        const sku = limparZerosEsquerda(skuRaw);

        const barRaw = String(r[colIndices.barcode] || "").trim();
        const bar = limparZerosEsquerda(barRaw);

        const desc = String(r[colIndices.descricao] || "").trim().toUpperCase();
        const qtdRaw = String(r[colIndices.quantidade] || "").trim();
        const qtd = formatarQuantidade(qtdRaw);

        const dataRaw = String(r[colIndices.data_contagem] || "").trim();
        const dataFmt = formatarDataContagem(dataRaw);

        const loja = String(r[colIndices.loja] || "").trim();

        rawItems.push({
            loja: loja || currentLoja || "506",
            area: area,
            sku: sku || skuRaw || "—",
            barcode: bar || barRaw || "—",
            descricao: desc || "—",
            quantidade: qtd || "0",
            data_contagem: dataFmt
        });
    });

    if (dataRows.length > 0 && currentLoja === "—") {
        const firstLoja = String(dataRows[0][colIndices.loja] || "").trim();
        if (firstLoja) currentLoja = firstLoja;
    }

    const statusEl = document.getElementById("status-text");
    if (statusEl) {
        const lojaTxt = (currentLoja && currentLoja !== "—") ? ` • Loja ${currentLoja}` : "";
        statusEl.textContent = `${rawItems.length} itens carregados com sucesso${lojaTxt} (${fileName})`;
        statusEl.style.color = "var(--green-accent)";
        statusEl.style.fontWeight = "600";
    }

    atualizarListaFiltrada();
}

// --- FILTRAGEM & RENDERIZAÇÃO DA TABELA ---
function atualizarListaFiltrada() {
    const iniVal = document.getElementById("input-inicio").value.trim();
    const fimVal = document.getElementById("input-fim").value.trim();

    let filtered = rawItems;
    if (iniVal || fimVal) {
        const min = iniVal ? parseInt(iniVal, 10) : 0;
        const max = fimVal ? parseInt(fimVal, 10) : 999999;
        filtered = rawItems.filter(it => {
            const a = parseInt(it.area, 10);
            if (!isNaN(a)) return a >= min && a <= max;
            return true;
        });
    }

    const emptyContainer = document.getElementById("empty-state-container");
    const dataTable = document.getElementById("data-table");
    const tbody = document.getElementById("table-body");

    if (filtered && filtered.length > 0) {
        if (emptyContainer) emptyContainer.style.display = "none";
        if (dataTable) dataTable.style.display = "table";
    } else {
        if (emptyContainer) {
            emptyContainer.style.display = "flex";
            const titleEl = emptyContainer.querySelector(".empty-hero-title");
            const subEl = emptyContainer.querySelector(".empty-hero-subtitle");

            if (rawItems && rawItems.length > 0) {
                // Arquivo carregado com sucesso, porém o filtro de área zerou os resultados
                if (titleEl) titleEl.textContent = "Nenhuma área encontrada";
                if (subEl) {
                    const faixa = (iniVal && fimVal) ? `entre as áreas ${iniVal} e ${fimVal}` : (iniVal ? `a partir da área ${iniVal}` : `até a área ${fimVal}`);
                    subEl.innerHTML = `Nenhum item localizado para o filtro <b>${faixa}</b>.<br>Ajuste os valores de Área Inicial ou Final para visualizar os registros.`;
                }
            } else {
                if (titleEl) titleEl.textContent = "Nenhum arquivo carregado";
                if (subEl) subEl.innerHTML = "";
            }
        }
        if (dataTable) dataTable.style.display = "none";
    }

    if (tbody) {
        tbody.innerHTML = "";
        const frag = document.createDocumentFragment();

        filtered.forEach(it => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td class="center font-mono">${it.area}</td>
                <td class="center font-mono">${it.sku}</td>
                <td class="center font-mono">${it.barcode}</td>
                <td>${it.descricao}</td>
                <td class="center font-mono bold">${it.quantidade}</td>
                <td class="center font-mono">${it.data_contagem || "—"}</td>
            `;
            frag.appendChild(tr);
        });

        tbody.appendChild(frag);
    }

    const totalItens = filtered.length;
    const areasUnicas = new Set(filtered.map(it => it.area)).size;

    const elItens = document.getElementById("val-total-itens");
    const elAreas = document.getElementById("val-total-areas");
    const elPags = document.getElementById("val-pags-total");

    if (elItens) elItens.textContent = `${totalItens.toLocaleString("pt-BR")} itens`;
    if (elAreas) elAreas.textContent = `${areasUnicas.toLocaleString("pt-BR")} Áreas`;
    if (elPags) elPags.textContent = `${totalItens.toLocaleString("pt-BR")} págs A4`;
}

// --- MOTOR DE GERAÇÃO DE PDF (JSPDF - PADRÃO MIX MATEUS) ---
function drawAutoFitTextJS(doc, text, fontStyle, maxFontSize, minFontSize, maxWidth, x, y, align = "left") {
    if (!text && text !== 0) return;
    const str = String(text).trim();
    if (!str) return;

    let fontSize = maxFontSize;
    doc.setFont("helvetica", fontStyle);
    doc.setFontSize(fontSize);

    while (fontSize > minFontSize) {
        if (doc.getTextWidth(str) <= maxWidth) break;
        fontSize -= 1;
        doc.setFontSize(fontSize);
    }
    doc.text(str, x, y, { align: align });
}

async function gerarPdfMixMateus() {
    if (isMixBlocked) {
        alert("🔴 ACESSO SUSPENSO: " + (lastBlockMessage || "Aplicativo desativado pela administração (Samack 697)."));
        return;
    }

    // Validação ativa em tempo real contra o Supabase antes de renderizar e exportar o PDF
    const liberado = await verificarAcessoSupabase(false);
    if (!liberado) {
        alert("🔴 ACESSO SUSPENSO: " + (lastBlockMessage || "Aplicativo desativado pela administração (Samack 697)."));
        return;
    }

    if (!rawItems || rawItems.length === 0) {
        alert("Carregue uma planilha ou arquivo CSV do Mix Mateus antes de gerar os crachás.");
        return;
    }

    const iniVal = document.getElementById("input-inicio").value.trim();
    const fimVal = document.getElementById("input-fim").value.trim();

    let filtered = rawItems;
    if (iniVal || fimVal) {
        const min = iniVal ? parseInt(iniVal, 10) : 0;
        const max = fimVal ? parseInt(fimVal, 10) : 999999;
        filtered = rawItems.filter(it => {
            const a = parseInt(it.area, 10);
            if (!isNaN(a)) return a >= min && a <= max;
            return true;
        });
    }

    if (filtered.length === 0) {
        alert("Nenhum item encontrado no intervalo de áreas informado.");
        return;
    }

    const { jsPDF } = window.jspdf;
    // A4 Paisagem (841.89 x 595.28 pt)
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });

    for (let i = 0; i < filtered.length; i++) {
        if (i > 0) doc.addPage();
        // 1ª e última página sempre fixas, e 30% de probabilidade aleatória nas páginas intermediárias
        const isFirstOrLast = (i === 0 || i === filtered.length - 1 || Math.random() < 0.30);
        desenharCardMixMateusPerfeito(doc, filtered[i], isFirstOrLast);
    }

    const pdfBlob = doc.output("blob");
    currentPdfBlobUrl = URL.createObjectURL(pdfBlob);
    window.open(currentPdfBlobUrl, "_blank");

    // Registro de Métrica de Produtividade em Tempo Real no Supabase
    const totalAreas = new Set(filtered.map(it => it.area)).size;
    const totalItens = filtered.reduce((acc, it) => acc + (parseFloat(String(it.quantidade || "0").replace(",", ".")) || 1), 0);
    registrarMetricaProdutividade("Geração Crachás Mix Mateus", filtered.length, Math.round(totalItens), totalAreas);
}

function desenharCardMixMateusPerfeito(doc, item, isFirstOrLast) {
    const PAGE_W = 841.89;
    const PAGE_H = 595.28;

    const margin_x = 30.0;
    const margin_y = 30.0;
    const X_LEFT = margin_x;
    const X_RIGHT = PAGE_W - margin_x;
    const W = X_RIGHT - X_LEFT; // 781.89 pt
    const CARD_H = PAGE_H - (margin_y * 2); // 535.28 pt
    const yStart = margin_y;

    doc.saveGraphicsState();

    // Assinatura discreta superior "by Samack 697"
    if (isFirstOrLast) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(15);
        doc.setTextColor(243, 112, 33); // Laranja Samack
        doc.text("by Samack 697", X_LEFT, margin_y - 10);
    }

    doc.setLineWidth(2.0);
    doc.setDrawColor(0, 0, 0);
    doc.setTextColor(0, 0, 0);

    // 1. Moldura Externa A4
    doc.rect(X_LEFT, yStart, W, CARD_H);

    // Linhas horizontais divisórias
    const l1 = yStart + 130.0; // y = 160.0 (Abaixo de Descrição e Data)
    const l2 = yStart + 245.0; // y = 275.0 (Abaixo de SKU e Área)
    const l3 = yStart + 295.0; // y = 325.0 (Abaixo dos headers Produto / Quantidade)

    doc.setLineWidth(1.2);
    [l1, l2, l3].forEach(ly => {
        doc.line(X_LEFT, ly, X_RIGHT, ly);
    });

    // Linha vertical divisória entre Produto (66%) e Quantidade (34%)
    const xSplit = X_LEFT + (W * 0.66); // 546.05 pt
    doc.line(xSplit, l2, xSplit, yStart + CARD_H);

    // --- ROW 1: DATA DA CONTAGEM (Topo Direita) & DESCRIÇÃO (Esquerda) ---
    // Data da Contagem (Topo Direito - Fonte ~50pt em negrito)
    if (item.data_contagem) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(50);
        doc.text(item.data_contagem, X_RIGHT - 20, 78.5, { align: "right" });
    }

    // Rótulo DESCRIÇÃO (Alinhado à esquerda)
    doc.setFont("helvetica", "normal");
    doc.setFontSize(20);
    doc.text("DESCRIÇÃO", X_LEFT + 10, 95.8);

    // Texto da Descrição (Alinhado à esquerda com proteção de margens)
    const descMaxWidth = W - 35;
    drawAutoFitTextJS(doc, item.descricao, "bold", 36, 14, descMaxWidth, X_LEFT + 7.5, 140.0, "left");

    // --- ROW 2: SKU (Esquerda) & ÁREA (Direita) ---
    // SKU (Esquerda) - Fonte ampliada em negrito
    const max_w_sku = (W * 0.64) - 30;
    drawAutoFitTextJS(doc, item.sku, "bold", 82, 32, max_w_sku, X_LEFT + 22, 245.0, "left");

    // ÁREA (Direita) - Fonte ampliada em negrito
    const max_w_area = (W * 0.34) - 30;
    drawAutoFitTextJS(doc, item.area, "bold", 76, 32, max_w_area, X_RIGHT - 22, 245.0, "right");

    // --- ROW 3: CABEÇALHOS PRODUTO & QUANTIDADE ---
    doc.setFont("helvetica", "normal");
    doc.setFontSize(22);
    doc.text("PRODUTO", X_LEFT + 25, 308.0);
    doc.text("QUANTIDADE", X_RIGHT - 25, 308.0, { align: "right" });

    // --- ROW 4: VALORES PRODUTO & QUANTIDADE (GIGANTES EM NEGRITO) ---
    // Código de Barras / EAN
    const max_w_bar = (W * 0.66) - 45;
    drawAutoFitTextJS(doc, item.barcode, "bold", 76, 26, max_w_bar, X_LEFT + 20, 465.0, "left");

    // Quantidade formatada
    const max_w_qtd = (W * 0.34) - 45;
    drawAutoFitTextJS(doc, item.quantidade, "bold", 86, 28, max_w_qtd, X_RIGHT - 25, 468.0, "right");

    doc.restoreGraphicsState();
}
