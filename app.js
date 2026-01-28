// app.js

// === ESTADO GLOBAL ===
let dadosCSV = [];
let gaugeChart = null;
let refreshTimer = null;
let secondsLeft = 600;

// Configuração do Plugin da Agulha (Needle) para o Chart.js
const gaugeNeedle = {
    id: 'gaugeNeedle',
    afterDatasetDraw(chart, args, options) {
        const { ctx, config, data, chartArea: { top, bottom, left, right, width, height } } = chart;
        
        ctx.save();
        
        // Valor atual (Soma das vendas do ano) / Meta Total
        // O Chart.js doughnut desenha em angulos. Precisamos calcular o angulo da agulha.
        // O dataset 0 é o background (trimestres), o dataset 1 (se houver) seria o progresso.
        // Vamos usar uma logica simples: 0 a 100% mapeado em -90deg a 90deg (semi-circulo).
        
        const valorTotal = data.datasets[0].needleValue || 0;
        const metaTotal = data.datasets[0].metaTotal || 1;
        let percentage = valorTotal / metaTotal;
        if (percentage > 1) percentage = 1; // Trava em 100%
        if (percentage < 0) percentage = 0;

        const cx = width / 2;
        const cy = height - 10; // Ajuste para base do semi-circulo
        
        // Angulo: Math.PI é 180 graus. Começa em Math.PI (esquerda) e vai até 2*Math.PI (direita)
        // No ChartJS rotation -90 deixa o topo em 0. Circumference 180 faz meio circulo.
        
        const angle = Math.PI + (percentage * Math.PI); 

        ctx.translate(cx, top + (height/1.3)); // Ponto de pivo da agulha
        ctx.rotate(angle);

        // Desenhar Agulha
        ctx.beginPath();
        ctx.moveTo(0, -5);
        ctx.lineTo(height/1.5, 0); // Comprimento
        ctx.lineTo(0, 5);
        ctx.fillStyle = document.body.classList.contains('light-theme') ? '#333' : '#fff';
        ctx.fill();
        
        // Bolinha central
        ctx.beginPath();
        ctx.arc(0, 0, 8, 0, Math.PI * 2);
        ctx.fillStyle = '#6366f1'; // Cor da bolinha
        ctx.fill();

        ctx.restore();
    }
};

// === INICIALIZAÇÃO ===
document.addEventListener('DOMContentLoaded', () => {
    initFilters();
    initGauge();
    loadRefreshPreference();
    fetchData();
    startTimer();
});

// === CARGA DE DADOS (PapaParse) ===
async function fetchData() {
    try {
        const response = await fetch(CONFIG.CSV_URL + '&cb=' + Date.now());
        const csvText = await response.text();
        
        Papa.parse(csvText, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => {
                dadosCSV = results.data;
                updateDashboard();
                updateLastUpdate();
            }
        });
    } catch (error) {
        console.error("Erro ao carregar CSV:", error);
    }
}

// === LÓGICA DE NEGÓCIO ===
function updateDashboard() {
    const filtros = getFiltros();
    
    // 1. Filtrar Dados
    const dadosFiltrados = dadosCSV.filter(row => {
        const anoMatch = row['ANO'] == filtros.ano;
        const mesMatch = row['MES'] == filtros.mes; // Assume MES como '1', '2'... ou '01'
        
        // Normalização da linha
        const linhaRow = row['LINHA'] ? row['LINHA'].trim() : '';
        const linhaFiltro = filtros.linha;
        const linhaMatch = linhaFiltro === 'todas' || linhaRow === linhaFiltro;

        return anoMatch && mesMatch && linhaMatch;
    });

    // 2. Calcular Totais (KPIs)
    let kpis = {
        metaMes: 0,
        vendas: 0,
        emCasa: 0,
        liberar: 0,
        faturados: 0,
        orcamentosValor: 0
    };

    dadosFiltrados.forEach(row => {
        kpis.metaMes += parseMoney(row['META_MES']);
        kpis.vendas += parseMoney(row['VALOR_PEDIDOS']);
        kpis.emCasa += parseInt(row['PEDIDOS_EM_CASA'] || 0); // Ajuste conforme nome exato da coluna no CSV novo
        kpis.liberar += parseInt(row['PEDIDOS_A_LIBERAR'] || 0);
        kpis.faturados += parseInt(row['PEDIDOS_FATURADOS_MES'] || 0);
        kpis.orcamentosValor += parseMoney(row['VALOR_ORCAMENTOS']);
    });

    // 3. Lógica Meta Diária Acumulada
    // Meta do Mês / Dias totais do Mês * Dia Atual
    const hoje = new Date();
    const diasNoMes = new Date(filtros.ano, filtros.mes, 0).getDate();
    const diaAtual = hoje.getDate();
    // Se estivermos olhando mês passado, considera mês cheio. Se for mês atual, considera dia de hoje.
    const isMesAtual = (parseInt(filtros.mes) === (hoje.getMonth() + 1)) && (parseInt(filtros.ano) === hoje.getFullYear());
    const diasCorridos = isMesAtual ? diaAtual : diasNoMes;
    
    const metaDiariaAcumulada = (kpis.metaMes / diasNoMes) * diasCorridos;

    // 4. Atualizar DOM KPIs
    document.getElementById('kpi-meta-mes').innerText = formatMoney(kpis.metaMes);
    document.getElementById('kpi-meta-dia').innerText = formatMoney(metaDiariaAcumulada);
    document.getElementById('kpi-vendas').innerText = formatMoney(kpis.vendas);
    
    document.getElementById('kpi-em-casa').innerText = kpis.emCasa;
    document.getElementById('kpi-liberar').innerText = kpis.liberar;
    document.getElementById('kpi-faturados').innerText = kpis.faturados;
    document.getElementById('label-mes-ref').innerText = `${filtros.mes}/${filtros.ano}`;

    // 5. Atualizar Cards de Franquias
    renderFranquias(dadosCSV, filtros);

    // 6. Atualizar Gauge Anual (Busca dados do ANO todo, independente do mês selecionado)
    updateGauge(filtros.ano);
}

function updateGauge(ano) {
    // Somar vendas de TODO o ano selecionado
    const dadosAno = dadosCSV.filter(row => row['ANO'] == ano);
    const totalVendasAno = dadosAno.reduce((acc, row) => acc + parseMoney(row['VALOR_PEDIDOS']), 0);
    
    // Atualizar Chart
    gaugeChart.data.datasets[0].needleValue = totalVendasAno;
    gaugeChart.data.datasets[0].metaTotal = CONFIG.META_ANUAL;
    gaugeChart.update();

    // Texto
    document.getElementById('gauge-valor-anual').innerText = formatMoney(totalVendasAno);
    const pct = (totalVendasAno / CONFIG.META_ANUAL) * 100;
    document.getElementById('gauge-percent').innerText = pct.toFixed(1) + '%';
}

function renderFranquias(dados, filtros) {
    const container = document.getElementById('franchise-container');
    container.innerHTML = '';

    const franquias = [
        { id: 'FRA - Brasil Cacau', icon: 'logo-bc.png', color: '#f97316' }, // Use imagens se tiver, ou cores
        { id: 'FRA - Cacau Show', icon: 'logo-cs.png', color: '#8b4513' },
        { id: 'FRA - Kopenhagen', icon: 'logo-kp.png', color: '#e11d48' },
        { id: 'IND - Industries', icon: 'logo-ind.png', color: '#3b82f6' },
        { id: 'PLB - PolyBee', icon: 'logo-pb.png', color: '#fbbf24' },
    ];

    franquias.forEach(fra => {
        // Filtrar dados específicos da franquia no mês/ano
        const dadosFra = dados.filter(row => 
            row['ANO'] == filtros.ano && 
            row['MES'] == filtros.mes && 
            (row['LINHA'] && row['LINHA'].trim() === fra.id)
        );

        // Consolidar
        let fOrc = 0, fVenda = 0, fQtdPed = 0;
        dadosFra.forEach(r => {
            fOrc += parseMoney(r['VALOR_ORCAMENTOS']);
            fVenda += parseMoney(r['VALOR_PEDIDOS']);
            fQtdPed += parseInt(r['QTDE_PEDIDOS'] || 0);
        });

        // Conversão por VALOR (Pedido / Orçamento)
        let conversao = fOrc > 0 ? (fVenda / fOrc) * 100 : 0;
        let ticket = fQtdPed > 0 ? (fVenda / fQtdPed) : 0;

        // HTML do Card
        const html = `
            <div class="franchise-card" style="border-top: 3px solid ${fra.color}">
                <div class="fra-header">
                    <div class="fra-icon" style="background:${fra.color}"></div>
                    <div class="fra-title">
                        <h3>${fra.id.replace('FRA - ', '').replace('IND - ', '').replace('PLB - ', '')}</h3>
                        <span>${filtros.mes}/${filtros.ano}</span>
                    </div>
                </div>
                <div class="fra-row">
                    <span class="fra-label">Nº Orçamentos</span>
                    <span class="fra-val">-</span> </div>
                <div class="fra-row">
                    <span class="fra-label">Valor Orç.</span>
                    <span class="fra-val">${formatMoney(fOrc)}</span>
                </div>
                <div class="fra-row">
                    <span class="fra-label">Valor Venda</span>
                    <span class="fra-val money">${formatMoney(fVenda)}</span>
                </div>
                 <div class="fra-row">
                    <span class="fra-label">Ticket Médio</span>
                    <span class="fra-val">${formatMoney(ticket)}</span>
                </div>
                <div class="fra-row" style="margin-top:5px; padding-top:5px; border-top:1px dashed #333">
                    <span class="fra-label">Conversão ($)</span>
                    <span class="fra-val" style="color:${conversao >= 30 ? '#22c55e' : '#fff'}">${conversao.toFixed(1)}%</span>
                </div>
            </div>
        `;
        container.innerHTML += html;
    });
}

// === GAUGE CHART SETUP ===
function initGauge() {
    const ctx = document.getElementById('gaugeChart').getContext('2d');
    
    // Dados dos trimestres vindos do CONFIG
    const dataValues = CONFIG.TRIMESTRES.map(t => t.valor);
    const labels = CONFIG.TRIMESTRES.map(t => t.nome);
    
    // Cores (Escala de cinza para o fundo)
    const bgColors = ['#334155', '#475569', '#64748b', '#94a3b8']; 

    gaugeChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: dataValues,
                backgroundColor: bgColors,
                borderWidth: 2,
                borderColor: '#1e1b4b', // Cor do fundo para "separar" os gomos
                cutout: '70%', // Espessura do arco
                circumference: 180, // Semi-circulo
                rotation: -90, // Começa na esquerda
                needleValue: 0, // Valor inicial
                metaTotal: CONFIG.META_ANUAL
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: { enabled: true }
            }
        },
        plugins: [gaugeNeedle] // Injeta o plugin da agulha
    });
}

// === UTILS & CONTROLS ===
function getFiltros() {
    return {
        ano: document.getElementById('filterAno').value,
        mes: document.getElementById('filterMes').value,
        linha: document.getElementById('filterLinha').value
    };
}

function initFilters() {
    // Popular Anos e Meses dinamicamente ou estático
    const selAno = document.getElementById('filterAno');
    const selMes = document.getElementById('filterMes');
    
    // Anos
    [2024, 2025, 2026].forEach(ano => {
        let opt = new Option(ano, ano);
        if(ano === new Date().getFullYear()) opt.selected = true;
        selAno.add(opt);
    });

    // Meses
    const meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    meses.forEach((m, i) => {
        let val = (i+1).toString().padStart(2, '0');
        let opt = new Option(m, val);
        if((i+1) === (new Date().getMonth() + 1)) opt.selected = true;
        selMes.add(opt);
    });
}

function toggleFilterMenu() {
    document.getElementById('filter-menu').classList.toggle('active');
}

function applyFilters() {
    updateDashboard();
    toggleFilterMenu(); // Fecha menu
}

function toggleTheme() {
    const body = document.body;
    const icon = document.getElementById('theme-icon');
    
    if (body.getAttribute('data-theme') === 'dark') {
        body.setAttribute('data-theme', 'light');
        icon.classList.replace('ph-moon', 'ph-sun');
    } else {
        body.setAttribute('data-theme', 'dark');
        icon.classList.replace('ph-sun', 'ph-moon');
    }
}

// === TIMER & REFRESH ===
function loadRefreshPreference() {
    const saved = localStorage.getItem('dash_refresh_sec');
    if (saved) {
        secondsLeft = parseInt(saved);
        document.getElementById('refresh-select').value = saved;
    }
}

function changeRefreshTime() {
    const val = document.getElementById('refresh-select').value;
    secondsLeft = parseInt(val);
    localStorage.setItem('dash_refresh_sec', val);
    // Reinicia o loop
    clearInterval(refreshTimer);
    startTimer();
}

function startTimer() {
    const display = document.getElementById('countdown');
    // Pega o valor base
    let totalTime = parseInt(document.getElementById('refresh-select').value);
    let currentCount = totalTime;

    refreshTimer = setInterval(() => {
        currentCount--;
        
        // Formatar MM:SS
        let m = Math.floor(currentCount / 60);
        let s = currentCount % 60;
        display.innerText = `${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;

        if (currentCount <= 0) {
            fetchData(); // Recarrega dados
            currentCount = totalTime; // Reseta timer
        }
    }, 1000);
}

function updateLastUpdate() {
    const now = new Date();
    document.getElementById('last-update').innerText = `Atualizado: ${now.toLocaleTimeString()}`;
}

// Helpers de Formatação
function parseMoney(val) {
    if (typeof val === 'number') return val;
    if (!val) return 0;
    // Remove R$, pontos e troca virgula por ponto
    let clean = val.replace('R$', '').trim().replaceAll('.', '').replace(',', '.');
    return parseFloat(clean) || 0;
}

function formatMoney(val) {
    return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}