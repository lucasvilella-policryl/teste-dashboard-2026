// config.js
const CONFIG = {
  // Meta Anual Total (R$ 9 Milhões)
  META_ANUAL: 9000000, 

  // Definição das Metas por Trimestre (Valores absolutos)
  TRIMESTRES: [
    { nome: "1º Trim", valor: 1350000 }, // ~15% (Exemplo)
    { nome: "2º Trim", valor: 3150000 }, // ~35%
    { nome: "3º Trim", valor: 3150000 }, // ~35%
    { nome: "4º Trim", valor: 1350000 }  // ~15%
  ],

  // Link da Planilha (Mantenha o seu link atualizado aqui)
  CSV_URL: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQKstKflONSWvQ6xfVkMdM53mveopLXVGNv9CyQT0kRbjdI7IGIVzvvMPLSXNyQ-xZTQEvDmKr1jI_I/pub?gid=1199309873&single=true&output=csv'
};