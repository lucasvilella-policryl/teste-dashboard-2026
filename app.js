// app.js

// === ESTADO GLOBAL ===
let dadosCSV = [];
let gaugeChart = null;
let refreshTimer = null;
let secondsLeft = 600;

// Configuração do Plugin da Agulha (Needle)
const gaugeNeedle = {
    id: 'gaugeNeedle',
    afterDatasetDraw(chart, args, options) {
        const { ctx, config, data, chartArea: { top, bottom, left, right, width, height } } = chart;
        
        ctx.save();
        
        const valorTotal = data.datasets[0].needleValue || 0;
        const metaTotal = data.datasets[0].metaTotal || 1;
        let percentage = valorTotal / metaTotal;
        if (percentage > 1) percentage = 1;
        if (percentage < 0) percentage = 0;

        const cx = width / 2;
        const cy = height - 5; // Base do arco
        
        // Calcular ângulo (-90 a 90 graus em radianos)
        const angle = Math.PI + (percentage * Math.PI); 

        ctx.translate(cx, top + (height / 1.35)); // Ajuste do pino da agulha
        ctx.rotate(angle);

        // Desenhar Agulha
        ctx.beginPath();
        ctx.moveTo(0, -5);
        ctx.lineTo(height / 1.6, 0); // Comprimento da agulha
        ctx.lineTo(0, 5);
        ctx.fillStyle = document.body.getAttribute('data-theme') === 'light' ? '#333' : '#fff';
        ctx.fill();
        
        // Bolinha central
        ctx.beginPath();
        ctx.arc(0, 0, 8, 0, Math.PI * 2);
        ctx.fillStyle = '#6366f1';
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

// === CARGA DE DADOS ===
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
        const mesMatch = row['MES'] == filtros.mes;
        
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
        kpis.emCasa += parseInt(row['PEDIDOS_EM_CASA'] || 0);
        kpis.liberar += parseInt(row['PEDIDOS_A_LIBERAR'] || 0);
        kpis.faturados += parseInt(row['PEDIDOS_FATURADOS_MES'] || 0);
        kpis.orcamentosValor += parseMoney(row['VALOR_ORCAMENTOS']);
    });

    // 3. Meta Diária Acumulada
    const hoje = new Date();
    const diasNoMes = new Date(filtros.ano, filtros.mes, 0).getDate();
    const diaAtual = hoje.getDate();
    const isMesAtual = (parseInt(filtros.mes) === (hoje.getMonth() + 1)) && (parseInt(filtros.ano) === hoje.getFullYear());
    const diasCorridos = isMesAtual ? diaAtual : diasNoMes;
    
    const metaDiariaAcumulada = (kpis.metaMes / diasNoMes) * diasCorridos;

    // 4. Atualizar DOM
    document.getElementById('kpi-meta-mes').innerText = formatMoney(kpis.metaMes);
    document.getElementById('kpi-meta-dia').innerText = formatMoney(metaDiariaAcumulada);
    document.getElementById('kpi-vendas').innerText = formatMoney(kpis.vendas);
    
    document.getElementById('kpi-em-casa').innerText = kpis.emCasa;
    document.getElementById('kpi-liberar').innerText = kpis.liberar;
    document.getElementById('kpi-faturados').innerText = kpis.faturados;
    document.getElementById('label-mes-ref').innerText = `${filtros.mes}/${filtros.ano}`;

    // 5. Renderizar Franquias
    renderFranquias(dadosCSV, filtros);

    // 6. Atualizar Gauge Anual
    updateGauge(filtros.ano);
}

function updateGauge(ano) {
    const dadosAno = dadosCSV.filter(row => row['ANO'] == ano);
    const totalVendasAno = dadosAno.reduce((acc, row) => acc + parseMoney(row['VALOR_PEDIDOS']), 0);
    
    gaugeChart.data.datasets[0].needleValue = totalVendasAno;
    gaugeChart.data.datasets[0].metaTotal = CONFIG.META_ANUAL;
    gaugeChart.update();

    document.getElementById('gauge-valor-anual').innerText = formatMoney(totalVendasAno);
    const pct = (totalVendasAno / CONFIG.META_ANUAL) * 100;
    document.getElementById('gauge-percent').innerText = pct.toFixed(1) + '%';
}

function renderFranquias(dados, filtros) {
    const container = document.getElementById('franchise-container');
    container.innerHTML = '';

    const franquias = [
        { id: 'FRA - Brasil Cacau', color: '#f97316' },
        { id: 'FRA - Cacau Show', color: '#8b4513' },
        { id: 'FRA - Kopenhagen', color: '#e11d48' },
        { id: 'IND - Industries', color: '#3b82f6' },
        { id: 'PLB - PolyBee', color: '#fbbf24' },
    ];

    franquias.forEach(fra => {
        const dadosFra = dados.filter(row => 
            row['ANO'] == filtros.ano && 
            row['MES'] == filtros.mes && 
            (row['LINHA'] && row['LINHA'].trim() === fra.id)
        );

        let fOrc = 0, fVenda = 0, fQtdPed = 0;
        dadosFra.forEach(r => {
            fOrc += parseMoney(r['VALOR_ORCAMENTOS']);
            fVenda += parseMoney(r['VALOR_PEDIDOS']);
            fQtdPed += parseInt(r['QTDE_PEDIDOS'] || 0);
        });

        let conversao = fOrc > 0 ? (fVenda / fOrc) * 100 : 0;
        let ticket = fQtdPed > 0 ? (fVenda / fQtdPed) : 0;

        const html = `
            <div class="franchise-card" style="border-top: 4px solid ${fra.color}">
                <div class="fra-header">
                    <div class="fra-icon" style="background:${fra.color}"></div>
                    <div class="fra-title">
                        <h3>${fra.id.replace('FRA - ', '').replace('IND - ', '').replace('PLB - ', '')}</h3>
                        <span>${filtros.mes}/${filtros.ano}</span>
                    </div>
                </div>
                
                <div class="fra-body">
                    <div class="fra-row">
                        <span class="fra-label">Orçamentos</span>
                        <span class="fra-val">${formatMoney(fOrc)}</span>
                    </div>
                    <div class="fra-row">
                        <span class="fra-label">Venda</span>
                        <span class="fra-val money">${formatMoney(fVenda)}</span>
                    </div>
                    <div class="fra-row">
                        <span class="fra-label">Ticket Méd.</span>
                        <span class="fra-val">${formatMoney(ticket)}</span>
                    </div>
                    <div class="fra-row" style="margin-top:5px; padding-top:10px; border-top:1px dashed rgba(255,255,255,0.1)">
                        <span class="fra-label">Conversão</span>
                        <span class="fra-val" style="color:${conversao >= 30 ? '#22c55e' : '#fff'}">${conversao.toFixed(1)}%</span>
                    </div>
                </div>
            </div>
        `;
        container.innerHTML += html;
    });
}

function initGauge() {
    const ctx = document.getElementById('gaugeChart').getContext('2d');
    
    // Busca valores definidos no config.js
    const dataValues = CONFIG.TRIMESTRES.map(t => t.valor);
    const labels = CONFIG.TRIMESTRES.map(t => t.nome);
    
    // Cores (Degradê de cinza/azul para os setores)
    const bgColors = ['#1e293b', '#334155', '#475569', '#64748b']; 

    gaugeChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: dataValues,
                backgroundColor: bgColors,
                borderWidth: 2,
                borderColor: '#1a1640', // Cor do fundo do header para separar
                cutout: '75%', 
                circumference: 180, 
                rotation: -90, 
                needleValue: 0, 
                metaTotal: CONFIG.META_ANUAL
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: { padding: { bottom: 0 } },
            plugins: {
                legend: { display: false },
                tooltip: { enabled: true }
            }
        },
        plugins: [gaugeNeedle]
    });
}

// === UTILS ===
function getFiltros() {
    return {
        ano: document.getElementById('filterAno').value,
        mes: document.getElementById('filterMes').value,
        linha: document.getElementById('filterLinha').value
    };
}

function initFilters() {
    const selAno = document.getElementById('filterAno');
    const selMes = document.getElementById('filterMes');
    
    [2024, 2025, 2026].forEach(ano => {
        let opt = new Option(ano, ano);
        if(ano === new Date().getFullYear()) opt.selected = true;
        selAno.add(opt);
    });

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
    toggleFilterMenu();
}

function toggleTheme() {
    const body = document.body;
    const icon = document.getElementById('theme-icon');
    
    if (body.getAttribute('data-theme') === 'light') {
        body.removeAttribute('data-theme'); // Volta pro dark
        icon.classList.replace('ph-sun', 'ph-moon');
    } else {
        body.setAttribute('data-theme', 'light');
        icon.classList.replace('ph-moon', 'ph-sun');
    }
}

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
    clearInterval(refreshTimer);
    startTimer();
}

function startTimer() {
    const display = document.getElementById('countdown');
    let totalTime = parseInt(document.getElementById('refresh-select').value);
    let currentCount = totalTime;

    refreshTimer = setInterval(() => {
        currentCount--;
        
        let m = Math.floor(currentCount / 60);
        let s = currentCount % 60;
        display.innerText = `${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;

        if (currentCount <= 0) {
            fetchData();
            currentCount = totalTime;
        }
    }, 1000);
}

function updateLastUpdate() {
    const now = new Date();
    document.getElementById('last-update').innerText = `Atualizado: ${now.toLocaleTimeString()}`;
}

function parseMoney(val) {
    if (typeof val === 'number') return val;
    if (!val) return 0;
    let clean = val.replace('R$', '').trim().replaceAll('.', '').replace(',', '.');
    return parseFloat(clean) || 0;
}

function formatMoney(val) {
    return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
