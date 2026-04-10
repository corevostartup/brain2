# ANCC — Artificial Neuroplastic Cognitive Correlation (Brain2)

Módulo TypeScript em `web/src/ancc`. Regra central: **«Every memory link must earn its place repeatedly.»** — toda ligação de memória deve reconquistar relevância; há decaimento e reforço, não é tudo ligado a tudo.

## Fluxo por interação (alvo)

1. User Input  
2. Raw Interpretation  
3. Topic Extraction  
4. Obsidian-style Link Generation (`[[note]]`)  
5. Correlation Strength Scoring  
6. Memory Class Assignment  
7. Context Assembly  
8. Hidden System Prompt Enrichment (`[ANCC Context Layer]` …)  
9. LLM Response *(fora do módulo)*  
10. Interaction Outcome Analysis — `analyzeInteractionOutcome` em `agents/outcome-agent.ts`; orquestrado por `finalizeInteractionAfterResponse` após a resposta.  
11. Link Reweighting — plasticidade pré-LLM (`mergeWithPlasticity`) + fatores pós-resposta (`OUTCOME_WEIGHTING` + `adjustMemoryGraphForOutcome`).  
12. Memory Graph Adjustment — atualização do mapa de ativações em `agents/memory-graph-agent.ts` (reforço/decaimento/nós novos conforme o outcome).  

## Comportamento obrigatório (MVP)

- **Cada interação** deve receber um snapshot dos ficheiros do vault (`VaultFileSnapshot[]`) e **procurar correlações** em notas existentes; só promover ligações com relevância acima de um limiar (`MIN_CORRELATION_TO_LINK` / relevância por ficheiro em `vault-correlation.ts`).
- Força dos links: combinação de `topic_match`, `recurrence`, `recency`, `structural_importance` (ver `rules/link-strength.rules.ts`).
- **Plasticidade**: `mergeWithPlasticity` — reforço quando o tópico volta; decaimento quando fica inativo (ver `rules/plasticity.rules.ts`).

## API de entrada principal

- `processInteraction({ ... })` → `ANCCProcessResult` com `hiddenSystemBlock` para injetar no system prompt junto ao prompt base Brain2.  
- Após a resposta do LLM: `finalizeInteractionAfterResponse({ userMessage, assistantMessage, preInteractionResult, plasticityState, vaultNoteTitles })` → outcome + ligações ajustadas; `enrichAnccProcessResultWithOutcome` para persistência no vault.

## Integração Brain2

- O cliente ou a rota `/api/chat` deve passar o texto do utilizador e a lista de `.md` lidos do vault (nome, path, conteúdo, `modifiedAt`).
- Mensagens ao LLM: **system base** + **bloco ANCC** + histórico + mensagem atual.

## Ficheiros-chave

| Área | Caminho |
|------|---------|
| Modelos | `web/src/ancc/models/` |
| Agentes | `web/src/ancc/agents/` |
| Regras | `web/src/ancc/rules/` |
| Pipeline | `web/src/ancc/pipeline/` |
| Export | `web/src/ancc/index.ts` |

## Lembrete

O ANCC é um **módulo separado** reutilizável como API; evitar acoplar UI diretamente à lógica dos agentes — consumir via `processInteraction` e tipos exportados.
