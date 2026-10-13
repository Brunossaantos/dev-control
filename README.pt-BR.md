# Dev Control

Painel universal para Claude Code: consumo, notificações, Zen, temas, perfis e agentes. Não impõe etapas ou um fluxo de desenvolvimento específico.

## Instalação

Requer **Claude Code 2.1.296 ou superior**, com suporte a mods/function hooks habilitado. Essa API está em acesso antecipado; sua disponibilidade depende do Claude Code e da conta. O pacote foi validado e testado com 2.1.296.

Extraia o ZIP. No PowerShell, entre na pasta `dev-control` extraída e execute:

```powershell
claude --version
claude plugin marketplace add .
claude plugin install dev-control@dev-control-mods --scope user
```

Abra uma nova sessão ou use `/reload-plugins`. Abra o painel pelo botão **◆ dev-control ▲** ou por `/dev-control`.

Para experimentar sem instalar, na mesma pasta:

```powershell
claude --plugin-dir ./plugins/dev-control
```

O plugin tem nome, comando e marketplace próprios. Para evitar disputa pela mesma área de interface, desative extra-mods se estiver ativo:

```powershell
claude plugin disable extra-mods@jdsjh-mods --scope user
```

## O que está incluído

| Seção | Função |
|---|---|
| Usage monitor | Contexto, limites 5h/7d, horários de renovação, última consulta e atualização manual. |
| Notifications | Avisos no terminal, som e notificação do sistema; canais e eventos independentes. |
| Zen mode | Progresso por etapas, detalhes expansíveis e erros visíveis. |
| Theme | Temas com prévia ao vivo, mantendo a integração original com Windows Terminal. |
| Mode | Modelo, esforço, permissões nativas e opção de preservar esforço dos subagentes. |
| Profiles | Salvar controles para um projeto ou como padrão global. |
| Agents | Lista real do motor, estado, tarefa, modelo/esforço observados e trecho do resultado. |
| Status line | Modelo, pasta, branch, contexto, limites e estimativa de idade do cache. |

## Notificações

Abra `/dev-control notifications`.

- **Terminal notice**: aviso dentro do Claude Code; ligado por padrão.
- **Sound**: som curto incluído no pacote; desligado por padrão.
- **Desktop notification**: aviso do sistema; desligado por padrão.
- **Context thresholds** e **5h / 7d thresholds**: ligados por padrão.
- **Main response finished**: opcional, desligado por padrão; indica fim da resposta, não garante conclusão da tarefa.
- **Tool / response errors** e **Waiting for input**: ligados por padrão.
- **Thresholds**: de 1 a 6 porcentagens inteiras entre 1 e 100. Padrão `70, 85, 95`.
- **Check readings**: intervalo mínimo de 15 a 300 segundos. O timer verifica a cada 15 segundos; padrão de consulta 30 segundos.
- **Other event cooldown**: de 5 a 600 segundos; padrão 60. O cooldown é separado para erros, término e solicitação de entrada.
- **Send test notification**: testa os canais selecionados e mostra o resultado no painel.

Cada faixa de consumo avisa uma vez por janela e sessão. Ao saltar várias faixas, envia um aviso com a faixa mais alta. Nova janela ou queda significativa do contexto rearma os alertas. Leituras ausentes não são tratadas como zero.

| Sistema | Notificação externa |
|---|---|
| Windows | Balão do sistema via Windows PowerShell e ícone temporário na bandeja. |
| macOS | `osascript` e permissão de notificações do sistema. |
| Linux | `notify-send`, quando instalado e disponível em uma sessão gráfica. |
| WSL | Tenta Windows PowerShell; depende da interoperabilidade e do ambiente Windows. |

O sistema pode bloquear ou silenciar notificações. Aceitar o comando não comprova que o usuário viu o aviso. Falhas de um canal não desativam os demais. Nenhuma dependência de notificação é instalada automaticamente.

## Leituras e continuidade

O contexto mede o tamanho da conversa; os limites 5h/7d medem uso da conta. Os limites vêm da última resposta API disponível ao motor. A consulta periódica relê esses dados; não é uma consulta externa de saldo.

O plugin não calcula uma quantidade exata de mensagens restantes e não demonstra economia de tokens. `cache ~ok` / `~over` é uma estimativa por idade da última resposta, com janela de uma hora, não uma confirmação de cache hit.

**Prepare handoff request**, em Usage monitor, preserva o rascunho e acrescenta uma solicitação de resumo de continuidade. Você envia com Enter. Não existe geração automática de resumos ou compactação automática.

## Zen

Somente etapas marcadas como concluídas contam no percentual. Ao terminar uma resposta, o painel diferencia conclusão, espera, interrupção e falha. Sem etapas, não há progresso calculável. O andamento informado pela IA não substitui resultados de testes.

Erros, interrupções e comandos com código de saída não zero continuam visíveis. **Expand tool details** e **[show details]** exibem os detalhes normais. Os subagentes não sobrescrevem o plano principal.

## Perfis

Em **Profiles**, salve para o projeto atual ou como padrão global. No início de uma nova sessão, o perfil do projeto tem prioridade sobre o global.

São guardados modelo, esforço do agente principal, Zen, tema escolhido e notificações. Os perfis ficam no armazenamento privado do plugin; não criam arquivos dentro do repositório do projeto. Remover um perfil não altera a sessão atual.

As permissões continuam usando os controles reais do Claude Code: Shift+Tab altera a sessão; o controle de modo padrão do menu modifica novas sessões. Nenhum perfil remove validações ou confirmações do motor.

Temas preservam o comportamento do original: podem modificar `~/.claude/settings.json` e o perfil do Windows Terminal, com backup. Outras abas no mesmo perfil Windows Terminal podem acompanhar a mudança de cores. A opção para sobrescrever esforço dos subagentes é somente da sessão e fica desligada por padrão.

## Agentes

O painel observa agentes já iniciados pelo usuário ou pelo Claude. Não inicia agentes nem inventa percentuais. Modelo, esforço e trecho do resultado aparecem quando os eventos correspondentes foram observados nesta sessão. O resultado mostrado tem até 1.000 caracteres; `/tasks` oferece o gerenciamento nativo. A lista exibe os 12 últimos resultados do filtro.

## Comandos

```text
/dev-control
/dev-control usage
/dev-control notifications
/dev-control zen
/dev-control themes
/dev-control mode
/dev-control profiles
/dev-control agents
/dev-control handoff
```

## Atualizar ou remover

Mantenha a pasta extraída no mesmo local. Depois de substituir os arquivos por uma versão nova, atualize o marketplace e o plugin:

```powershell
claude plugin marketplace update dev-control-mods
claude plugin update dev-control@dev-control-mods
```

Para remover:

```powershell
claude plugin uninstall dev-control@dev-control-mods --scope user
```

## Desenvolvimento e créditos

Não exige npm ou Python para usar o plugin. O script Python em `statusline/` é a versão independente herdada do projeto original e não implementa os novos recursos do mod.

```powershell
claude plugin validate ./plugins/dev-control --strict
claude plugin test ./plugins/dev-control
```

Para TypeScript, gere as declarações atuais com `/plugin-types` no Claude Code e ajuste o include de `tsconfig.json` se o motor gravá-las em outro local. As declarações da API de acesso antecipado devem corresponder à sua versão.

Baseado em [ClaudeMods](https://github.com/Jhonatan-de-Souza/ClaudeMods), de Jhonatan de Souza. Veja [NOTICE.md](NOTICE.md), [CHANGELOG.md](CHANGELOG.md) e [VERIFICACAO.md](VERIFICACAO.md).
