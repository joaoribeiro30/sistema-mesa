# Design System Master File — Sistema MESA

> **LOGIC:** Ao construir ou refatorar uma página ou componente, leia este `MASTER.md` primeiro e verifique se existe um override em `design-system/sistema-mesa/pages/<page>.md`. Regras do override têm precedência sobre o Master.
>
> **PROJECT:** Sistema MESA — Eventos & Reservas de Mesas em Tempo Real
> **MODE:** Strictly Light Mode (`color-scheme: only light`) · WCAG 2.2 AA (contraste mínimo **4.5:1** em texto normal e **3:1** em elementos gráficos/bordas interativas).

---

## 1. Direção Visual & Padrão

- **Estilo:** Minimalismo Editorial + Swiss Functional UI (alto contraste, superfícies claras neutras, acento de marca contido, dados numéricos tabulares, foco total na planta e no fluxo de reserva).
- **Stack:** React 19 + TypeScript + Tailwind CSS v4 (`@tailwindcss/vite`) + Lucide Icons (`lucide-react`).
- **Breakpoints oficiais de validação:**
  - Mobile base: `375px` (`< 768px`, mobile-first)
  - Tablet: `768px` (`md:`)
  - Desktop padrão: `1280px` (`lg:` / `xl:`, container `max-w-7xl`)

---

## 2. Paleta de Cores (Strictly Light Mode — Contraste Verificado)

### 2.1 Superfícies, Texto e Marca

| Papel | Hex / Valor | CSS Variable | Contraste verificado |
|---|---|---|---|
| Canvas (fundo da página) | `#F6F6F8` | `--bg-canvas` | Base clara |
| Surface (cards, drawers, planta) | `#FFFFFF` | `--bg-surface` | Base clara |
| Elevated (chips, superfícies secundárias) | `#F0F0F4` | `--bg-elevated` | Distinção sutil sobre `#FFFFFF` |
| Hover surface | `#E7E7EE` | `--bg-hover` | Estado hover neutro |
| Glass header | `rgba(246, 246, 248, 0.88)` | `--bg-glass` | Backdrop blur leve |
| Border subtle | `rgba(12, 12, 18, 0.10)` | `--border-subtle` | Divisores internos |
| Border strong | `rgba(12, 12, 18, 0.24)` | `--border-strong` | Bordas de controles / mapas |
| Text primary | `#0B0B10` | `--text-primary` | **19.63:1** sobre `#FFFFFF` |
| Text secondary | `#525260` | `--text-secondary` | **7.68:1** sobre `#FFFFFF` / **6.76:1** sobre `#F0F0F4` |
| Text muted | `#575766` | `--text-muted` | **7.09:1** sobre `#FFFFFF` / **6.24:1** sobre `#F0F0F4` |
| CTA primary bg / text | `#0B0B10` / `#FFFFFF` | `--cta-bg` / `--cta-text` | **19.63:1** (AAA) |
| CTA hover | `#24242F` | `--cta-hover` | **15.10:1** com `#FFFFFF` |
| Brand accent (seleção ativa) | `#BE123C` | `--accent` | **6.29:1** com `#FFFFFF` |
| Accent soft surface | `#FFF1F2` | `--accent-soft` | **7.58:1** com `#9F1239` |
| Accent text on soft | `#9F1239` | `--accent-ink` | **7.58:1** sobre `#FFF1F2` |
| Accent border | `rgba(190, 18, 60, 0.40)` | `--accent-border` | Realce de seleção |
| Danger | `#B91C1C` | `--danger` | **6.47:1** sobre `#FFFFFF` |
| Warning button bg / text | `#9A3412` / `#FFFFFF` | `--warning-solid` | **7.31:1** (substitui `#A14D0A` + `#111`, que falhava em 3.22:1) |

### 2.2 Estados Semânticos de Mesa (Cor + Borda + Padrão + Ícone)

> **Regra crítica (`color-not-only`):** Nenhum estado pode depender apenas de cor. Todo estado combina **superfície + borda/estilo + padrão de preenchimento + ícone Lucide + texto acessível**. Nunca aplicar `opacity-*` sobre texto ou badges de mesas indisponíveis (evitar queda de contraste abaixo de 4.5:1).

| Estado de Domínio (API → UI) | Superfície (`bg`) | Borda | Texto (`fg`) | Contraste Texto/Bg | Padrão Visual | Ícone |
|---|---|---|---|---|---|---|
| `AVAILABLE` → **Disponível** | `#ECFDF5` (`--status-available-bg`) | `2px solid #047857` (`--status-available-border`) | `#065F46` (`--status-available-fg`) | **7.29:1** (AAA) | Liso limpo + sombra sutil | `CircleCheck` / dot sólido |
| `SELECTED` (local) → **Selecionada** | `#BE123C` (`--status-selected-bg`) | `2px solid #FFFFFF` + anel `2px #BE123C` | `#FFFFFF` (`--status-selected-fg`) | **6.29:1** (AA+) | Sólido preenchido + halo externo | `Check` (micro-badge no marcador) |
| `RESERVED` (`PENDING_PAYMENT`) → **Pagamento pendente** | `#FEF3C7` (`--status-pending-bg`) | `2px dashed #B45309` (`--status-pending-border`) | `#7C2D12` (`--status-pending-fg`) | **8.42:1** (AAA) | Listras diagonais 45° sutis (`repeating-linear-gradient`) | `Clock` (micro-badge + expiração) |
| `SOLD` → **Vendida** | `#E2E8F0` (`--status-sold-bg`) | `1.5px solid #475569` (`--status-sold-border`) | `#334155` (`--status-sold-fg`) | **8.40:1** (AAA) | Hachura diagonal cruzada sutil | `Lock` (micro-badge no marcador) |

---

## 3. Tipografia

- **Display / Headings:** `"Space Grotesk", "Inter", system-ui, sans-serif` (`letter-spacing: -0.025em`)
- **Body / UI:** `"Inter", system-ui, -apple-system, BlinkMacSystemFont, sans-serif`
- **Numéricos / Preços / Contadores / Zoom:** `"JetBrains Mono", ui-monospace, monospace` + `font-variant-numeric: tabular-nums` (`.font-mono-num`) — obrigatório em contadores SSE, preços, timers e % de zoom para evitar tremores horizontais.
- **Tamanhos mínimos:**
  - Corpo/labels legíveis: `12px–14px` (inputs mobile `>= 16px` para evitar auto-zoom no iOS)
  - Marcador de mesa na planta: mínimo `10px–11px` bold (`font-bold`) em cápsula de `28px–32px` dentro de área clicável `44×44px`.

---

## 4. Ergonomia de Toque, Foco e Acessibilidade (WCAG 2.2 AA)

- **Área de toque mínima:** `44×44px` (`size-11` / `min-h-11 min-w-11`) em **todos** os alvos interativos no mobile (marcadores de mesa, controles de zoom/centralizar, fechar drawer/toast, chips de filtro, steppers de convidados `-`/`+`, botões de remoção).
- **Espaçamento entre alvos de controle:** mínimo `8px` (`gap-2`) em toolbars e grupos de ação.
- **Foco visível:** `focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--text-primary)]` em todo elemento interativo (nunca remover outline sem substituto de alto contraste).
- **Alternativa sem arrasto (`Dragging Movements`):** Toda navegação por pan/pinch no mapa deve oferecer controles equivalentes por clique/toque simples e teclado (`+`, `-`, `Centralizar`, filtro por setor com foco automático).
- **Anúncio acessível em tempo real (`Contextual Live Updates`):** Usar uma única região `role="status" aria-live="polite" aria-atomic="true"` com mensagens contextuais completas (ex.: `"Mesa V2 liberada agora"`, `"Mesa V2 reservada por outro comprador"`), sem roubar foco do usuário.

---

## 5. Movimento, SSE em Tempo Real e Zero CLS

- **Tokens de duração:**
  - `--motion-fast: 150ms` (feedback de clique/hover)
  - `--motion-state: 280ms` (transição de cor/borda de estado da mesa via SSE)
  - `--motion-sheet: 260ms` (entrada de Bottom Sheet / Drawer)
  - `--motion-pulse: 1400ms` (anel de pulso único ao receber evento SSE remoto)
- **Regra GPU-only & Zero CLS:**
  - Animar exclusivamente `transform`, `opacity`, `background-color`, `border-color`, `color`, `box-shadow`. Nunca animar `width`, `height`, `top`, `left` ou inserir banners de notificação no fluxo normal do DOM acima do mapa.
  - Desativar transições (`transition-none`) durante arrasto/pinch ativo do dedo para latência zero (`< 16ms/frame`), reativando apenas em cliques de zoom/reset.
  - Transições SSE devem ser canceláveis: mudanças rápidas na mesma mesa substituem o pulso anterior sem depender de `animationend` para consistência de estado.
- **Reduced Motion:** Respeitar rigorosamente `@media (prefers-reduced-motion: reduce)` removendo pulsos/slides e preservando apenas feedback cromático imediato.

---

## 6. Escala de Z-Index

| Camada | Classe Tailwind | Uso |
|---|---|---|
| Base da planta | `z-0` / `z-10` | Imagem/blueprint e marcadores padrão |
| Marcador ativo/hover/foco | `z-20` / `z-30` | Marcador selecionado, focado ou sob ponteiro |
| HUD do mapa | `z-20` | Controles de zoom, dica de gesto, inspetor ancorado (desktop) |
| Tooltip de marcador (desktop) | `z-40` | Popover contextual de mesa |
| Header fixo / SelectionBar | `z-40` | Navegação global e barra fixa de seleção |
| Bottom Sheet / Toast SSE flutuante | `z-50` | Drawer de detalhes da mesa (mobile) e notificações SSE sem CLS |
| Modais críticos / CheckoutDrawer | `z-50` | `ReservationLockModal`, `CheckoutDrawer`, `TicketModal` |

---

## 7. Anti-Patterns Proibidos

- ❌ Dark mode ou `prefers-color-scheme: dark` overrides (produto é estritamente Light Mode).
- ❌ Indicar estado de mesa apenas por cor sem ícone/borda/padrão.
- ❌ Dependência exclusiva de `:hover` para visualizar preço, setor, capacidade ou tempo de expiração.
- ❌ Inserir avisos SSE ou o card de detalhes da mesa inline no fluxo vertical empurrando o mapa (CLS).
- ❌ Bloquear pan/pinch quando o toque começa sobre um marcador em plantas densas.
- ❌ Usar `opacity-55` / `opacity-75` em textos de itens vendidos/bloqueados reduzindo contraste abaixo de 4.5:1.
- ❌ Controles interativos mobile abaixo de `44×44px` (ex.: `h-5 w-5` em steppers ou `p-1` em botões de fechar).
