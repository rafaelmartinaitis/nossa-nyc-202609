# Nossa NYC — Rafael & Lídia

Planner visual da viagem de Nova York, 19–26 de setembro de 2026.

## O que já está implementado

- Layout em três faixas: header, planner central e gaveta inferior de passeios.
- Mesma lógica no desktop e no celular.
- Clique/toque em um card abre um modal com detalhes e botão ×.
- Segurar um card da gaveta ativa o modo de arraste e expande visualmente o planner.
- Soltar entre atividades adiciona/reordena o passeio.
- Arrastar um card do planner para a gaveta inferior remove do dia.
- Horários do dia são recalculados usando duração + deslocamentos.
- Custos exibidos sempre para o casal.
- Favorito simples com coração.
- Botão “Plano original” carrega o plano-base de Rafael & Lídia.
- Armazenamento local no navegador nesta primeira etapa.
- Estrutura pronta para GitHub Pages/PWA.
- Service worker para funcionamento offline básico.
- Manifest e ícones para adicionar à tela inicial.

## Estrutura

- `index.html` — shell da aplicação.
- `src/styles.css` — layout desktop/mobile.
- `src/app.js` — planner, drag, modal, custos e horários.
- `data/places.json` — banco de locais.
- `data/travel-times.json` — matriz de deslocamentos.
- `data/recommended-plan.json` — plano original.
- `manifest.webmanifest` — PWA.
- `sw.js` — cache offline.
- `src/config.example.js` — preparação para Supabase.

## Importante

Nesta versão, o plano é salvo apenas no `localStorage` do navegador.
A próxima etapa será adicionar sincronização compartilhada com Supabase para Rafael e Lídia editarem o mesmo planner.

Os horários e custos ainda são valores de planejamento e devem ser validados antes das reservas.

## Identidade visual

A interface usa uma linguagem editorial de viagem: creme/champagne, verde profundo, rosa queimado e tipografia serifada nos títulos. A intenção é que o planner pareça uma lembrança especial da viagem de Rafael & Lídia, e não uma ferramenta administrativa.


## Temas visuais

O projeto agora inclui dois temas:

- **Colorido** — versão mais afetiva e vibrante para a viagem de Rafael & Lídia.
- **Division-inspired** — inspirado na linguagem tática/urbana de Manhattan em *Tom Clancy's The Division*, sem copiar logos, artes oficiais ou interface proprietária. A referência está na atmosfera: laranja de HUD, azul petróleo, vidro técnico e sensação de operação urbana.

O botão de tema fica no header e também na gaveta inferior (atalho útil no celular).


## Indicações de Rafael e Lídia

Não existe mais um favorito genérico.

- No tema **Colorido**, Rafael é representado por coração azul e Lídia por coração vermelho.
- Um passeio pode estar marcado por Rafael, Lídia, pelos dois ou por nenhum.
- Na gaveta, os botões R e L filtram as indicações de cada um; os dois filtros juntos mostram somente os passeios indicados pelos dois.
- No tema **Division-inspired**, os corações são substituídos por marcadores táticos próprios: um losango azul/ciano para Rafael e um hexágono laranja para Lídia, mantendo a identidade de cada pessoa sem copiar ícones oficiais do jogo.

## V6 — planner semanal com faixas de horário

Correção estrutural do planner:

- **Desktop (acima de 680 px):** os oito dias, de 19 a 26 de setembro, aparecem lado a lado em uma grade semanal horizontal.
- **Eixo temporal:** 08:00 até 02:00 do dia seguinte, com linhas a cada meia hora e rótulos de hora em hora.
- A altura visual dos passeios é proporcional à duração real.
- Deslocamentos aparecem como faixas próprias antes do passeio.
- Esperas/tempo livre relevantes também aparecem no eixo do dia.
- Cards podem ser arrastados de uma coluna para outra e reordenados pelo ponto de soltura.
- A gaveta inferior continua sendo o banco de passeios; arrastar um card planejado de volta para ela remove do dia.
- **Mobile (até 680 px):** permanece um dia por vez, mas agora também com eixo visual de horário.
- Os botões `Tema`, `Plano original` e `Limpar` são forçados a permanecer visíveis no desktop.
- O service worker passou a usar **network-first** durante o desenvolvimento, para reduzir problemas de cache após novos commits.

## V7 — layout travado no viewport

- Header sempre visível.
- Gaveta sempre visível na parte inferior.
- Somente o planner central possui scroll.
- A semana foi compactada para reduzir a rolagem horizontal em desktops comuns.
- `index.html` usa `app.js` e `styles.css` da raiz para evitar versões duplicadas.
- Cache offline temporariamente desativado enquanto o layout está sendo refinado.

## V8 — otimização de performance

- Renderiza somente desktop **ou** mobile, nunca os dois ao mesmo tempo.
- Cacheia os cálculos de agenda por dia e só invalida quando o plano muda.
- Substitui centenas de listeners por delegação global de eventos.
- Drag é processado no máximo uma vez por frame com `requestAnimationFrame`.
- Remove `backdrop-filter`, sombras e camadas fixas caras da área de scroll.
- Usa `content-visibility`/`contain` para pular pintura de colunas e cards fora da tela.
- Service worker permanece desativado durante desenvolvimento.


## V9 — imagens e eventos com sessões reais

- Miniaturas são carregadas sob demanda via Wikipedia/Wikimedia para preservar desempenho.
- O modal carrega uma imagem maior somente quando aberto.
- `MJ The Musical` é um evento programado: só entra em sessões existentes.
- `New York Rangers — Madison Square Garden` só entra nos dois jogos reais dentro da viagem.
- Quando há mais de uma sessão no mesmo dia, o modal permite escolher.
- A sessão de MJ de 26/09 às 20h aparece desabilitada por conflitar com o voo de volta.


## V10 — voos fixos e auditoria de catálogo

- Chegada Delta 226 em JFK (19/09 05:29) aparece como âncora fixa.
- Em 26/09, o planner bloqueia a viagem a partir de 17:00 para retorno ao hotel, bagagens, deslocamento ao JFK e Delta 227 às 21:50.
- O planner rejeita qualquer alteração que faça o retorno ao hotel ultrapassar 17:00 no último dia.
- ARTE MUSEUM New York permanece no catálogo como `L08`, categoria “Exposição imersiva”.
- A lista-mestre L01–L45 foi validada sem itens ausentes.
- MJ (`E01`) e Rangers/MSG (`E02`) permanecem como eventos com sessões reais.
- Foram adicionados 18 cartões distintos que apareceram em discussões anteriores e não estavam na lista-mestre original, incluindo referências The Division, Outlook Hill e paradas específicas de Chinatown.
- `data/catalog-audit.json` registra automaticamente a checagem de integridade desta versão.


## V11 — sincronização entre dispositivos

Endpoint configurado: `https://wqjhhklysjqtxucduyah.supabase.co/functions/v1/trip-sync`

Fluxo:
- O site abre bloqueado por uma tela de senha.
- A senha é enviada à Edge Function; não existe senha hardcoded no JavaScript.
- Depois do login, `plan`, indicações Rafael/Lídia e sessões de eventos são carregados do Supabase.
- Alterações são salvas localmente imediatamente e enviadas ao Supabase com debounce.
- O site consulta mudanças de outro dispositivo a cada 10 segundos e também ao voltar para a aba.
- `theme` e o dia atualmente selecionado continuam locais por dispositivo.
- Em conflito de versão, nenhuma alteração é sobrescrita silenciosamente: o site pede para escolher entre a versão compartilhada e a versão deste dispositivo.
- A senha é mantida apenas em `sessionStorage`, portanto pode ser pedida novamente ao iniciar uma nova sessão do navegador.
