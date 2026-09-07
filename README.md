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
