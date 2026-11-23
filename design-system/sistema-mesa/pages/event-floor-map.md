# Page Override — Event Floor Map & Table Selection (`EventDetailPage` + `InteractiveFloorMap`)

> **Aplica-se a:** `EventDetailPage.tsx`, `InteractiveFloorMap.tsx`, `TableMapMarker.tsx`, `tableStatus.ts`, `SectorTableList.tsx`, `SelectionBar.tsx`.
> **Herda de:** `design-system/sistema-mesa/MASTER.md`.

---

## 1. Layout Overrides por Viewport

### Mobile (`375px`, `< 768px`)
- **Viewport do mapa:** Altura dedicada `h-[56dvh] min-h-[340px] max-h-[500px]` com padding compacto (`p-2.5 sm:p-4`) para maximizar a área útil da planta em telas estreitas sem scroll horizontal.
- **Legenda sempre visível:** Barra compacta no rodapé/topo do container do mapa exibindo os 4 estados (`Disponível`, `Selecionada`, `Pag. pendente`, `Vendida`) com amostra real (cor + borda/padrão + ícone) e contadores ao vivo em `tabular-nums`, fora do painel colapsável de filtros.
- **Toolbar de zoom acessível:** Barra limpa no topo do container com botões `size-11` (`44×44px`) de `-`, `%` (`tabular-nums`), `+`, `Centralizar`, e indicador de gesto (`Pinça ou arraste`).
- **Inspeção sem CLS (Bottom Sheet):** Ao tocar em uma mesa no mobile, abrir um **Bottom Sheet ancorado (`fixed inset-x-0 bottom-0 z-50`)** com backdrop leve, puxador visual, botão fechar `44×44px`, badge semântico (cor + ícone), setor, capacidade, preço, contagem regressiva (quando `PENDING_PAYMENT`) e CTA primário `min-h-12` (`Selecionar mesa` / `Remover seleção`) — evitando que o card inline empurre a página.

### Desktop (`1280px`, `>= 768px`)
- **Viewport do mapa:** `h-[560px]` (ou `lg:h-[600px]`), `max-w-7xl`, mantendo controles flutuantes de zoom/pan no canto superior direito e dica de interação (`Arraste · Pinça · Ctrl + Scroll`) no canto superior esquerdo.
- **Inspeção dupla sem dependência exclusiva de hover:**
  - **Hover / Focus (`:focus-visible`):** Tooltip compacto posicionado com detecção de borda horizontal e vertical (nunca corta nas laterais esquerda/direita ou topo da planta).
  - **Click / Seleção / Teclado:** Inspetor ancorado no canto inferior esquerdo do viewport do mapa (`absolute bottom-4 left-4 z-20`, zero CLS), sempre visível após clicar/focar qualquer mesa (inclusive `PENDING_PAYMENT` e `SOLD`) com botão fechar e ação direta.
  - **Interação de clique em `AVAILABLE` no desktop:** Mantém toggle imediato de seleção (compatível com o fluxo rápido e testes E2E existentes) + atualiza o inspetor ancorado.

---

## 2. Zoom & Pan Fluido para Plantas Densas

- **Escala:** `MIN_SCALE = 0.85`, `MAX_SCALE = 3.5` (permite separar agrupamentos densos de 50–100+ mesas no 375px), `SCALE_STEP = 0.3`.
- **Multi-touch nativo via Pointer Events (`Map<pointerId, { x, y }>`):**
  - **2 ponteiros (Pinch-to-Zoom):** Calcula distância e ponto médio entre os dois dedos, aplicando zoom focado no ponto médio (`focal zoom`) + pan simultâneo em tempo real com `transition-none`.
  - **1 ponteiro (Pan com threshold de 6px):** Permite iniciar o arrasto **mesmo começando sobre um marcador de mesa** (crucial em plantas lotadas!). Se o deslocamento ultrapassar `6px`, cancela o `click` subsequente do marcador e move o mapa; se `< 6px`, preserva o clique/toque normal na mesa.
  - **Limites de Pan (Clamping):** Limita `translate.x` e `translate.y` proporcionalmente às dimensões do viewport + palco escalado para que a planta nunca suma para fora da área visível.
  - **Coexistência com scroll vertical mobile:** `touch-action: none` quando `scale > 1` ou em gesto multi-toque; com `scale <= 1`, permitir pan horizontal/vertical suave dentro do mapa ou botão claro de foco/zoom, sem prender o usuário fora do viewport.
  - **Foco automático por setor:** Ao filtrar um setor específico, oferecer ação/transição suave para enquadrar (fit-to-sector) as mesas daquele setor ou resetar facilmente.
  - **Compensação inteligente de escala nos marcadores:** Manter área de toque mínima de `44×44px` no botão (`size-11`), usando compensação controlada (`clamp` na escala inversa) para que ao dar zoom os marcadores se afastem visualmente sem ficarem desproporcionais nem minúsculos.

---

## 3. Transições SSE em Tempo Real (Sem Layout Shift)

- **Estado de transições recentes (`recentTableUpdates`):**
  - `EventDetailPage` registra eventos SSE (`table.locked`, `table.released`, `table.sold`) com `{ tableId, kind, timestamp }` e expira o destaque visual após `1600ms` (cancelando timers antigos da mesma mesa).
- **Feedback no marcador (`TableMapMarker`) e card (`SectorTableList`):**
  - Transição suave de cores/bordas (`duration-300 ease-out`).
  - Anel de pulso único (`animate-sse-ring-*` via `transform: scale()` + `opacity`, `pointer-events-none`) sobre o marcador que acabou de mudar de status (esmeralda ao liberar, âmbar ao reservar/pendente, ardósia ao vender).
- **Notificações SSE flutuantes (Zero CLS):**
  - Remover o bloco `liveNotice` do fluxo normal acima do mapa e renderizá-lo como **toast flutuante fixo** (`fixed top-[72px] left-1/2 -translate-x-1/2 z-50` no mobile / `md:top-20 md:right-6 md:left-auto md:translate-x-0` no desktop), com `role="status" aria-live="polite" aria-atomic="true"`, botão fechar `44×44px` e auto-dismiss.
  - Anunciar tanto eventos que afetam a seleção do usuário quanto alterações remotas relevantes (com agrupamento/debounce leve para evitar spam em picos de venda).
