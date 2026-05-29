---
title: ACP Deployment 部署顺序与模块总览
type: runbook
category: devops
tags:
  - kubernetes
  - alauda
  - acp
  - deployment
  - runbook
  - platform-engineering
  - github-pages
created: 2026-05-29
updated: 2026-05-29
status: active
source: project
environment: generic
---

# ACP Deployment 部署顺序与模块总览

## 1. 背景

本文档基于当前项目 `deployment/` 目录下的部署资料整理而成，用于沉淀 ACP / Alauda 平台交付时的部署顺序、模块职责、依赖关系、风险点和验证方式。

本次整理范围包括：

- 集群创建
- 节点系统配置
- MetalLB
- IngressNginx
- Egress / Multus / Kube-OVN
- Registry / Registry Gateway
- VictoriaMetrics 监控
- 自定义指标和 Dashboard
- ClickHouse 日志链路
- 日志与指标外部转发
- RunOCP 自动化账号和命名空间策略
- Zabbix 对接
- Compliance Operator
- SentinelOne
- Etcd Backup
- LocalDNS
- Heartbeat 验证
- Registry image prune

## 2. 重要原则

### 2.1 禁止整体 apply deployment 目录

不要直接执行：

```bash
kubectl apply -f deployment/
```

原因：

- 目录中既有 Kubernetes YAML，也有 Helm 模板、说明文件、ModuleInfo、ResourcePatch 和示例配置。
- 多个文件包含占位符，例如 `<cluster-name>`、`<base64>`、`<egress node ip>`。
- 部分配置写死了示例环境名、IP、域名或集群名，发布前必须替换。
- ResourcePatch 依赖目标资源已存在，不能提前应用。
- 某些文件是合并版和拆分版，重复 apply 可能造成覆盖或冲突。
- Secret / TLS / S3 / token 等敏感配置必须在目标环境中重新生成或确认。

### 2.2 推荐执行方式

每个文件执行前先 dry-run：

```bash
kubectl apply --dry-run=server -f <file>
```

确认无误后再 apply：

```bash
kubectl apply -f <file>
```

对于 Alauda 平台 CRD，例如 `ModuleInfo`、`ResourcePatch`，可按现场规范使用：

```bash
ac apply -f <file>
```

### 2.3 推荐整理有序交付目录

建议不要直接修改原始 `deployment/`，而是生成有序目录：

```bash
mkdir -p deployment/ordered
```

命名格式：

```text
<阶段号>-<顺序号>-<模块>-<动作或资源>.yaml
```

示例：

```text
01-01-cluster-dcs-auth-secret.yaml
01-02-cluster-cluster.yaml
02-01-machineconfig-master-chrony.yaml
03-01-metallb-ipaddresspool.yaml
```

## 3. 部署阶段总览

完整推荐顺序：

```text
01-cluster-create
02-machineconfig
03-metallb
04-ingress
05-egress
06-registry
07-victoriametrics-monitoring
08-autoscale-dashboard
09-clickhouse-log
10-integration-log-monitor
11-runocp
12-zabbix
13-security-compliance-sentinelone
14-etcd-backup
15-localdns
16-heartbeat-validation
17-registry-image-prune
```

最小基础平台部署顺序：

```text
01-cluster-create
02-machineconfig
03-metallb
04-ingress
06-registry
07-victoriametrics-monitoring
09-clickhouse-log
14-etcd-backup
16-heartbeat-validation
```

## 4. 全局前置条件

### 4.1 权限和工具

需要具备：

- `kubectl`
- `ac`
- `helm`
- cluster-admin 权限
- global cluster 和 workload cluster 访问权限
- 创建或修改以下资源的权限：
  - CRD
  - ClusterRole / ClusterRoleBinding
  - ModuleInfo
  - ResourcePatch
  - Secret
  - Ingress
  - MachineConfig
  - MachineDeployment

### 4.2 平台能力

目标环境需要具备或即将部署：

- Cluster API / DCS controller
- ModuleInfo controller
- ResourcePatch controller
- Kube-OVN
- Multus
- MetalLB operator
- IngressNginx operator
- VictoriaMetrics operator
- Etcd backup controller
- Compliance operator，如需要合规扫描
- Kyverno，如需要命名空间策略
- AIT MonitorDashboard CRD，如需要自定义看板

### 4.3 网络规划

部署前必须确认：

- control plane IP
- worker IP
- ingress LoadBalancer IP
- MetalLB IP pool
- egress subnet
- egress external IP
- DNS server
- gateway
- cluster domain
- registry external domain
- platform ingress URL
- syslog server 地址和端口
- Zabbix server 地址

### 4.4 节点 label / taint 规划

多个组件依赖节点 label：

```text
ingress: "true"
egress: ""
log: ""
monitor: ""
registry: ""
heartbeat: "true"
node-role.kubernetes.io/infra: ""
```

infra 节点通常带 taint：

```yaml
key: node-role.kubernetes.io/infra
effect: NoSchedule
```

因此调度到 infra 节点的组件必须带 toleration。

### 4.5 证书、Secret、镜像

需要准备：

- registry TLS 证书和私钥
- default ingress TLS secret
- registry S3 access key / secret key
- etcd backup S3 access key / secret key
- ClickHouse S3 secret，如使用
- syslog CA cert，如日志或指标转发需要 TLS
- SentinelOne site key / token
- Zabbix server 地址
- proxy 地址，如 SentinelOne 需要
- 内部 registry 中的镜像，例如 heartbeat、Zabbix、SentinelOne、ac CLI 等

注意：本文档不会沉淀真实 token、密码、证书、客户数据和生产密钥。发布前必须脱敏。

## 5. 模块部署摘要

| 阶段 | 模块 | 主要资源 | 关键依赖 | 验证重点 |
|---|---|---|---|---|
| 01 | cluster-create | Cluster、DCSCluster、KubeadmControlPlane、MachineDeployment | CAPI / DCS、IP 规划、虚拟化认证 | Cluster、MachineDeployment、Node Ready |
| 02 | machineconfig | MachineConfig、MachineConfiguration | 集群和节点 Ready | MachineConfig 生效、节点滚动完成 |
| 03 | metallb | IPAddressPool、L2Advertisement、ModuleInfo | MetalLB operator、ingress IP 池 | LoadBalancer IP 可分配 |
| 04 | ingress | TLS Secret、IngressNginx | MetalLB、Ingress operator、ingress 节点 | ingress controller、LB IP、TLS |
| 05 | egress | NAD、Subnet、Vpc、VpcEgressGateway | Kube-OVN、Multus、egress 节点外部网卡 | 出口 Pod、VPC BFD、外部访问 |
| 06 | registry | TLS Secret、S3 Secret、ModuleInfo、Gateway | registry 节点、Ingress、S3 | push/pull、Ingress、Deployment 调度 |
| 07 | victoriametrics | ModuleInfo、adapter 修复 | monitor 节点、StorageClass | VM 组件、PVC、kubectl top |
| 08 | autoscale-dashboard | prometheus-adapter CM、MonitorDashboard | VictoriaMetrics、custom.metrics API | HPA 指标和看板 |
| 09 | clickhouse-log | ClickHouse、logagent、ResourcePatch、Secret | log 节点、S3、syslog CA | ClickHouse、razor、logagent、rpch |
| 10 | integration-log-monitor | vector/syslog、metric-forwarder、remoteWrite | 日志和监控组件已部署 | 外部 syslog / metric 接收端有数据 |
| 11 | runocp | SA、ClusterRole、RoleTemplate、Namespace 策略 | Kyverno、网络策略、安全评审 | RBAC、Quota、LimitRange、NetworkPolicy |
| 12 | zabbix | Helm chart、Proxy、Agent、Exporter | Zabbix server、内部镜像、monitor 节点 | proxy/agent 在线、token 可用 |
| 13 | security | Compliance Scan、SentinelOne | Compliance CRD、SentinelOne 镜像和凭据 | scan 结果、agent DaemonSet |
| 14 | etcd-backup | EtcdBackupConfiguration、S3 Secret | S3 endpoint、controller、控制平面访问 S3 | backup 对象生成并上传 S3 |
| 15 | localdns | kube-ovn-controller patch | Kube-OVN、NodeLocal DNS 方案 | 参数生效、controller 正常 |
| 16 | heartbeat | Namespace、Deployment、Service、Ingress | Ingress、httpd 镜像 | global/workload heartbeat 可访问 |
| 17 | registry-image-prune | CronJob | registry 可用、ac 镜像、RBAC | dry-run、手动 job、日志 |

## 6. 推荐执行 Runbook

### 6.1 集群创建

用途：创建 workload cluster / ACP 集群，包括 control plane、worker 和 infra 节点组。

关键文件：

```text
deployment/cluster-create/dcs-authentication/secret.yaml
deployment/cluster-create/Cluster/Cluster.yaml
deployment/cluster-create/DCSCluster/DCSCluster.yaml
deployment/cluster-create/DCSIpHostnamePool/DCSIpHostnamePool.yaml
deployment/cluster-create/DCSMachineTemplate/DCSMachineTemplate.yaml
deployment/cluster-create/KubeadmControlPlane/KubeadmControlPlane.yaml
deployment/cluster-create/machinedeployment/*.yaml
```

执行：

```bash
kubectl apply -f deployment/cluster-create/dcs-authentication/secret.yaml
kubectl apply -f deployment/cluster-create/Cluster/Cluster.yaml
kubectl apply -f deployment/cluster-create/DCSCluster/DCSCluster.yaml
kubectl apply -f deployment/cluster-create/DCSIpHostnamePool/DCSIpHostnamePool.yaml
kubectl apply -f deployment/cluster-create/DCSMachineTemplate/DCSMachineTemplate.yaml
kubectl apply -f deployment/cluster-create/KubeadmControlPlane/KubeadmControlPlane.yaml
kubectl apply -f deployment/cluster-create/machinedeployment/ingress.yaml
kubectl apply -f deployment/cluster-create/machinedeployment/egress.yaml
kubectl apply -f deployment/cluster-create/machinedeployment/log.yaml
kubectl apply -f deployment/cluster-create/machinedeployment/registry.yaml
```

验证：

```bash
kubectl get cluster
kubectl get dcscluster
kubectl get kubeadmcontrolplane
kubectl get machinedeployment -A
kubectl get nodes -o wide
kubectl get nodes --show-labels
```

### 6.2 MachineConfig

用途：配置 chrony、timezone、issue banner、MachineConfiguration。

执行：

```bash
kubectl apply -f deployment/machineconfig/99-master-chrony.yaml
kubectl apply -f deployment/machineconfig/99-worker-chrony.yaml
kubectl apply -f deployment/machineconfig/99-master-timezone-sgt-systemd.yaml
kubectl apply -f deployment/machineconfig/99-worker-timezone-sgt-systemd.yaml
kubectl apply -f deployment/machineconfig/99-master-issue.yaml
kubectl apply -f deployment/machineconfig/99-wokrer-issue.yaml
kubectl apply -f deployment/machineconfig/cluster-machineconfiguration.yaml
```

验证：

```bash
kubectl get machineconfig
kubectl get machineconfiguration
kubectl get nodes
kubectl get mcp
```

风险：MachineConfig 可能触发节点滚动更新，建议在维护窗口执行。

### 6.3 MetalLB

用途：为 IngressNginx 提供 LoadBalancer IP。

执行：

```bash
kubectl apply -f deployment/metallb/metallb-minfo.yaml
kubectl apply -f deployment/metallb/ipaddresspool.yaml
kubectl apply -f deployment/metallb/l2advertisement.yaml
```

验证：

```bash
kubectl get ipaddresspool -n metallb-system
kubectl get l2advertisement -n metallb-system
kubectl get pods -n metallb-system
```

### 6.4 IngressNginx

用途：提供集群 HTTP/HTTPS 入口。

执行：

```bash
kubectl apply -f deployment/ingress/default-app-tls.yaml
kubectl apply -f deployment/ingress/ingressnginx.yaml
```

验证：

```bash
kubectl get ingressnginx -n ingress-nginx-operator
kubectl get svc -n ingress-nginx-operator
kubectl get pods -n ingress-nginx-operator -o wide
```

重点确认：

- `proxy-body-size: "0"`
- LoadBalancer IP 正确分配
- ingress controller 调度到 ingress 节点

### 6.5 Egress

用途：配置 Kube-OVN Multus/macvlan 外部网络和 VpcEgressGateway。

执行：

```bash
kubectl apply -f deployment/egress/multus-minfo.yaml
kubectl apply -f deployment/egress/fixed.yaml
```

然后按现场规划编辑 VPC：

```bash
kubectl edit vpc ovn-cluster
```

确认 BFD 配置：

```yaml
spec:
  bfdPort:
    enabled: true
    ip: 10.255.255.255
    nodeSelector:
      matchLabels:
        egress: ""
```

再部署 egress gateway：

```bash
kubectl apply -f deployment/egress/veg.yaml
```

验证：

```bash
kubectl get network-attachment-definitions -A
kubectl get subnet
kubectl get vpc ovn-cluster -o yaml
kubectl get vpcegressgateway -A
kubectl get pods -A -o wide | grep -i egress
```

### 6.6 Registry

用途：配置平台内部 registry、registry gateway、TLS、S3 和镜像清理策略。

执行：

```bash
kubectl apply -f deployment/registry/registry-ssl.yaml
kubectl apply -f deployment/registry/registry-s3-secret.yaml
kubectl apply -f deployment/registry/registry-minfo.yaml
kubectl apply -f deployment/registry/registry-gateway-minfo.yaml
```

如需调整调度：

```bash
ac patch deployment -n cpaas-system image-registry \
  --type='merge' \
  -p='{"spec":{"template":{"spec":{"nodeSelector":{"registry":""}}}}}'

ac patch deployment -n cpaas-system registry-gateway-gateway \
  --type='merge' \
  -p='{"spec":{"template":{"spec":{"nodeSelector":{"registry":""}}}}}'
```

验证：

```bash
kubectl get secret -n cpaas-system registry-ssl registry-s3-secret
kubectl get deploy -n cpaas-system image-registry registry-gateway-gateway -o wide
kubectl get ingress -n cpaas-system
```

并验证镜像 push/pull。

### 6.7 VictoriaMetrics 和自定义指标

部署 VictoriaMetrics：

```bash
kubectl apply -f deployment/victoriametrics/vm.yaml
```

如需要 prometheus-adapter 修复：

```bash
kubectl apply -f deployment/victoriametrics/bug-fix/adapter-cm.yaml
```

自定义指标和 Dashboard：

```bash
kubectl apply -f deployment/autoscale-metrics/prometheus-adapter-cm.yaml
kubectl apply -f deployment/dashboard.yaml
```

验证：

```bash
kubectl get minfo -A | grep -i victoriametrics
kubectl get pods -n cpaas-system | grep -Ei 'victoria|vmagent|vmalert|adapter'
kubectl get pvc -n cpaas-system
kubectl get --raw /apis/custom.metrics.k8s.io/v1beta1 | head
kubectl get monitordashboard
```

### 6.8 ClickHouse 日志链路

用途：部署或配置 ClickHouse、logagent、razor、syslog secret 和 ResourcePatch。

执行：

```bash
kubectl apply -f deployment/clickhouse/s3-secret.yaml
kubectl apply -f deployment/clickhouse/secret-syslog.yaml
kubectl apply -f deployment/clickhouse/log-clickhouse-minfo.yaml
kubectl apply -f deployment/clickhouse/logagent-minfo.yaml
kubectl apply -f deployment/clickhouse/rp-click.yaml
kubectl apply -f deployment/clickhouse/rp-razor.yaml
```

验证：

```bash
kubectl get secret -n cpaas-system | grep -Ei 'clickhouse|syslog'
kubectl get pods -n cpaas-system -o wide | grep -Ei 'clickhouse|razor|log'
kubectl get rpch -A
kubectl get minfo -A | grep -Ei 'log|clickhouse'
```

### 6.9 日志和指标外部转发

日志转发通常不是直接 apply，而是：

1. 导出 `cpaas-vector` secret 中的 `vector.yaml`。
2. 修改 transforms 和 sinks。
3. patch 回 secret。
4. 如启用 TLS，给 razor/vector 挂载 syslog CA secret。

指标转发通常是：

1. 找到 VictoriaMetrics ModuleInfo。
2. 编辑 ModuleInfo 增加 remoteWrite。
3. 修改 `metric-forwarder-vector-config` secret。
4. 如启用 TLS，挂载 CA secret。

验证：

```bash
kubectl get secret -n cpaas-system cpaas-vector -o yaml
kubectl get secret -n cpaas-system metric-forwarder-vector-config -o yaml
kubectl get pods -n cpaas-system | grep -Ei 'vector|metric-forwarder|razor'
```

并在外部 syslog / metric 接收端确认数据。

### 6.10 RunOCP 自动化账号和命名空间策略

用途：创建自动化 namespace、ServiceAccount、ClusterRole、ClusterRoleBinding、RoleTemplate、NetworkPolicy、ResourceQuota、LimitRange、Kyverno Policy。

执行顺序：

```bash
kubectl apply -f deployment/integration/runocp/global-roletemplate/
kubectl apply -f deployment/integration/runocp/global-clusterrole/
kubectl apply -f deployment/integration/runocp/workload-cluster/
kubectl apply -f deployment/integration/runocp/namespace/namespace.yaml
kubectl apply -f deployment/integration/runocp/namespace/resourcequato.yaml
kubectl apply -f deployment/integration/runocp/namespace/limitrange.yaml
kubectl apply -f deployment/integration/runocp/namespace/networkpolicy.yaml
kubectl apply -f deployment/integration/runocp/namespace/kyvernopolicy.yaml
```

验证：

```bash
kubectl get ns
kubectl get sa -A | grep paas-bot-api
kubectl get clusterrole | grep runocp
kubectl get clusterrolebinding | grep runocp
kubectl get roletemplate -A
kubectl get networkpolicy -n <namespace>
kubectl get resourcequota -n <namespace>
kubectl get limitrange -n <namespace>
```

风险：RBAC 权限较大，必须经过安全评审，避免给自动化账号授予过宽权限。

### 6.11 Zabbix

用途：部署 Zabbix proxy、agent、exporter，对接外部 Zabbix server。

Helm 部署：

```bash
helm upgrade --install zabbix deployment/zabbix/zabbix \
  -n zabbix --create-namespace \
  -f deployment/zabbix/zabbix/values-zabbixproxy.yaml
```

integration 文件：

```bash
kubectl apply -f deployment/integration/zabbix/exporter-kube-state.yaml
kubectl apply -f deployment/integration/zabbix/zabbix.yaml
kubectl apply -f deployment/integration/zabbix/zabbix-deployment.yaml
```

验证：

```bash
kubectl get pods -n zabbix -o wide
kubectl get svc -n zabbix
kubectl get sa -n zabbix
kubectl get secret zabbix-service-account -n zabbix -o jsonpath='{.data.token}' | base64 -d
```

### 6.12 安全合规和 SentinelOne

Compliance：

```bash
kubectl apply -f deployment/compliance-operator/moduleinfo.yaml
kubectl apply -f deployment/compliance-operator/basic-scan.yaml
kubectl apply -f deployment/compliance-operator/Scheduled.yaml
```

SentinelOne：

```bash
helm upgrade --install sentinelone <chart-path> \
  -n sentinelone --create-namespace \
  -f deployment/sentinelone/values.yaml
```

验证：

```bash
kubectl get minfo -A | grep -i compliance
kubectl get scan -A
kubectl get scansuite -A
kubectl get pods -n sentinelone -o wide
kubectl get daemonset -n sentinelone
```

### 6.13 Etcd Backup

创建 S3 secret：

```bash
export ACCESS_KEY="<redacted-access-key>"
export SECRET_KEY="<redacted-secret-key>"

kubectl create secret generic etcd-backup-s3-secret \
  --from-literal=ACCESS_KEY="$ACCESS_KEY" \
  --from-literal=SECRET_KEY="$SECRET_KEY" \
  --dry-run=client -n cpaas-system -o yaml | kubectl apply -f -
```

应用备份配置：

```bash
kubectl apply -f deployment/etcdbackupconfiguration/change-dir-date.yaml
```

验证：

```bash
kubectl get etcdbackupconfiguration
kubectl get secret -n cpaas-system etcd-backup-s3-secret
aws s3 --endpoint https://<s3-url> ls s3://<bucket-name>/<dir> --profile <profile> --no-verify-ssl
```

### 6.14 LocalDNS

用途：给 kube-ovn-controller 增加 node-local-dns-ip 参数。

执行：

```bash
ac patch deploy -n kube-system kube-ovn-controller --type=json \
  --patch='[{"op": "add", "path": "/spec/template/spec/containers/0/args/-", "value": "--node-local-dns-ip=169.254.0.10"}]'
```

验证：

```bash
kubectl get deploy -n kube-system kube-ovn-controller -o yaml | grep node-local-dns-ip
kubectl get pods -n kube-system | grep kube-ovn-controller
```

### 6.15 Heartbeat 验证

Global：

```bash
kubectl apply -f deployment/heartbeat/global/ns.yaml
kubectl apply -f deployment/heartbeat/global/deployment.yaml
kubectl apply -f deployment/heartbeat/global/svc.yaml
kubectl apply -f deployment/heartbeat/global/ingress.yaml
```

Workload：

```bash
kubectl apply -f deployment/heartbeat/workload/ns.yaml
kubectl apply -f deployment/heartbeat/workload/deployment.yaml
kubectl apply -f deployment/heartbeat/workload/svc.yaml
kubectl apply -f deployment/heartbeat/workload/ingress.yaml
```

验证：

```bash
kubectl get ns acp-heartbeat
kubectl get deploy,svc,ingress -n acp-heartbeat
curl -k https://<heartbeat-domain>
```

### 6.16 Registry Image Prune

先 dry-run：

```bash
ac adm prune images
```

部署 CronJob：

```bash
kubectl apply -f deployment/registry/image-prune/cronjob.yaml
```

手动触发验证：

```bash
kubectl create job --from=cronjob/ac-prune-images-cronjob \
  ac-prune-images-cronjob-manual -n cpaas-system
```

验证：

```bash
kubectl get cronjob -n cpaas-system ac-prune-images-cronjob
kubectl get job -n cpaas-system ac-prune-images-cronjob-manual
kubectl logs -n cpaas-system job/ac-prune-images-cronjob-manual
```

## 7. 部署前检查清单

执行前逐项确认：

- [ ] 所有 `<xxx>` 占位符已替换。
- [ ] 所有示例环境名已替换为目标环境。
- [ ] 所有 IP、CIDR、gateway 已按目标环境修改。
- [ ] 所有 domain/host 已按目标环境修改。
- [ ] 所有 Secret 不再使用示例值。
- [ ] registry TLS 可用。
- [ ] ingress default TLS 可用。
- [ ] S3 endpoint 可达。
- [ ] syslog server 可达。
- [ ] 节点 label 正确。
- [ ] infra taint 对应组件已有 toleration。
- [ ] ResourcePatch 目标资源已存在。
- [ ] Helm template 没有被直接 apply。
- [ ] 合并版文件没有和拆分版重复 apply。
- [ ] 已对关键 YAML 执行 dry-run。

## 8. 部署后验证清单

部署完成后建议执行：

```bash
kubectl get nodes -o wide
kubectl get nodes --show-labels
kubectl get pods -A | grep -Ev 'Running|Completed'
kubectl get ingress -A
kubectl get svc -A | grep LoadBalancer
kubectl get pvc -A
kubectl get minfo -A
kubectl get rpch -A
```

重点验证：

- ingress 域名可访问。
- registry 可以 push/pull。
- egress namespace 可以出网。
- VictoriaMetrics 可以查询指标。
- prometheus-adapter custom metrics 可用。
- ClickHouse / 日志组件正常。
- syslog 能收到日志或指标。
- etcd backup 已生成并上传 S3。
- Zabbix proxy/agent 在线。
- Compliance Scan 有结果。
- SentinelOne Agent 在线。
- heartbeat global/workload 均可访问。

## 9. 回滚建议

### 9.1 通用回滚原则

- 优先回滚最近一次变更，不要直接删除整个模块。
- Secret、证书、S3、外部系统配置要保留备份。
- 对 MachineConfig、网络、Ingress、Registry 等高风险变更，必须在维护窗口操作。
- ResourcePatch 回滚前要确认 patch 影响的目标资源和字段。

### 9.2 常用回滚命令

查看资源：

```bash
kubectl get <kind> -A
kubectl describe <kind> <name> -n <namespace>
```

删除单个错误资源：

```bash
kubectl delete -f <file>
```

Helm 回滚：

```bash
helm history <release> -n <namespace>
helm rollback <release> <revision> -n <namespace>
```

Deployment 回滚：

```bash
kubectl rollout history deploy/<name> -n <namespace>
kubectl rollout undo deploy/<name> -n <namespace>
```

## 10. 风险点总结

| 风险 | 说明 | 建议 |
|---|---|---|
| 整目录 apply | 混合了模板、说明、示例和真实资源 | 必须按阶段和文件执行 |
| Secret 泄露 | TLS、S3、token、authKey 等可能出现在 YAML | 发布前脱敏，生产用 Secret 管理 |
| 示例环境残留 | 文件中可能含示例集群名、域名、IP | 发布前统一替换 |
| MachineConfig 滚动 | 可能触发节点重启或滚动 | 维护窗口执行 |
| ResourcePatch 提前执行 | 目标资源不存在会失败或不可预测 | 先确认目标资源存在 |
| Helm 模板误 apply | 模板文件不能直接 kubectl apply | 使用 Helm render/install |
| 网络配置错误 | ingress / egress / MetalLB 影响业务流量 | 先验证 IP 池、网关、BFD、路由 |
| RBAC 过宽 | runocp 自动化权限较大 | 安全评审、最小权限 |
| 外部集成不可达 | syslog、Zabbix、S3、proxy 依赖外部系统 | 部署前做连通性验证 |

## 11. 相关文档

- [[Vector 日志输出到 Kafka 最佳实践]]
