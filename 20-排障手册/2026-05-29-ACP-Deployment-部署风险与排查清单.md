---
title: ACP Deployment 部署风险与排查清单
type: troubleshooting
category: devops
tags:
  - kubernetes
  - alauda
  - acp
  - troubleshooting
  - deployment
  - checklist
  - production
created: 2026-05-29
updated: 2026-05-29
status: active
source: project
severity: medium
environment: generic
---

# ACP Deployment 部署风险与排查清单

## 1. 问题背景

当前项目 `deployment/` 目录包含大量平台部署 YAML、Helm 模板、ModuleInfo、ResourcePatch、Secret 示例、网络配置和外部集成配置。该目录适合作为交付资料库，但不适合整体直接执行。

本文档用于沉淀部署过程中的主要风险、排查命令、验证步骤和回滚思路。

## 2. 快速结论

ACP 平台部署的核心风险集中在：

1. 整目录 apply。
2. 占位符、示例环境名、示例 IP 未替换。
3. Secret / TLS / token / S3 凭据泄露或配置错误。
4. MachineConfig 触发节点滚动。
5. Ingress / MetalLB / Egress 网络配置影响业务流量。
6. ResourcePatch 目标资源不存在或 patch 字段不兼容。
7. Helm 模板被误当成普通 YAML apply。
8. RBAC 权限过宽。

## 3. 部署前必查

### 3.1 检查占位符

```bash
grep -R "<.*>" deployment/ --include='*.yaml' --include='*.yml' --include='*.md'
```

重点处理：

```text
<cluster-name>
<base64>
<egress node ip>
<auth-secret-name>
<load-balancer-ip-or-domain-name>
<s3-url>
<bucket-name>
```

### 3.2 检查示例环境名

```bash
grep -R -E "acpsit|acpuat|acp2|uat\.alauda|sit" deployment/ \
  --include='*.yaml' --include='*.yml' --include='*.md'
```

如果目标不是这些环境，必须替换。

### 3.3 检查敏感信息

```bash
grep -R -i -E "password|passwd|token|secret|authkey|access_key|secret_access_key|tls.key" deployment/ \
  --include='*.yaml' --include='*.yml' --include='*.md'
```

处理原则：

- 不把真实凭据提交到 Git。
- 使用 Kubernetes Secret、ExternalSecret 或现场密钥管理方案。
- 知识库和 GitHub Pages 只保留脱敏示例。

### 3.4 检查不可直接 apply 的模板

```bash
grep -R "{{ .* }}" deployment/ --include='*.yaml' --include='*.yml'
```

如果出现 Helm 模板语法，不能直接执行：

```bash
kubectl apply -f <helm-template-file>
```

应使用：

```bash
helm template <release> <chart-path> -f <values.yaml>
helm upgrade --install <release> <chart-path> -n <namespace> -f <values.yaml>
```

## 4. 常见问题与排查

### 4.1 Cluster / MachineDeployment 未创建成功

检查：

```bash
kubectl get cluster -A
kubectl get dcscluster -A
kubectl get kubeadmcontrolplane -A
kubectl get machinedeployment -A
kubectl describe machinedeployment <name> -n cpaas-system
kubectl get events -A --sort-by=.lastTimestamp | tail -100
```

常见原因：

- DCS 认证 Secret 错误。
- IP/hostname/machineName 不匹配。
- 虚拟化资源池、模板、网络配置错误。
- Cluster API ownerReference 或 namespace 不一致。

### 4.2 节点没有正确 label

检查：

```bash
kubectl get nodes --show-labels
kubectl get nodes -l ingress=true
kubectl get nodes -l egress=
kubectl get nodes -l log=
kubectl get nodes -l monitor=
kubectl get nodes -l registry=
```

补充 label 示例：

```bash
kubectl label node <node-name> ingress=true
kubectl label node <node-name> egress=
kubectl label node <node-name> log=
kubectl label node <node-name> monitor=
kubectl label node <node-name> registry=
```

注意：生产操作前必须确认节点用途和调度影响。

### 4.3 Pod 因 taint 无法调度

检查：

```bash
kubectl describe pod <pod-name> -n <namespace>
kubectl get nodes -o custom-columns=NAME:.metadata.name,TAINTS:.spec.taints
```

常见事件：

```text
node(s) had untolerated taint
```

处理：

- 给目标 workload 添加 toleration。
- 或调整节点 taint，但生产环境不建议随意移除 infra taint。

### 4.4 MetalLB 没有分配 LoadBalancer IP

检查：

```bash
kubectl get ipaddresspool -n metallb-system
kubectl get l2advertisement -n metallb-system
kubectl get svc -A | grep LoadBalancer
kubectl describe svc <svc-name> -n <namespace>
kubectl get pods -n metallb-system
```

常见原因：

- IP 池范围错误或冲突。
- L2Advertisement 未关联 IPAddressPool。
- MetalLB controller/speaker 异常。
- Service annotation 或 address pool 不匹配。

### 4.5 Ingress 不可访问

检查：

```bash
kubectl get ingressnginx -n ingress-nginx-operator
kubectl get svc -n ingress-nginx-operator
kubectl get pods -n ingress-nginx-operator -o wide
kubectl logs -n ingress-nginx-operator <ingress-controller-pod> --tail=200
kubectl get ingress -A
```

重点确认：

- LoadBalancer IP 是否分配。
- controller 是否调度到 ingress 节点。
- default TLS secret 是否存在。
- `proxy-body-size` 是否满足镜像上传等场景。
- DNS 是否解析到正确 IP。

### 4.6 Egress 出网失败

检查：

```bash
kubectl get network-attachment-definitions -A
kubectl get subnet
kubectl get vpc ovn-cluster -o yaml
kubectl get vpcegressgateway -A
kubectl get pods -A -o wide | grep -i egress
```

测试出网：

```bash
kubectl run egress-test -n <namespace> --rm -it --image=curlimages/curl -- sh
curl -v https://example.com
```

常见原因：

- egress 节点 label 缺失。
- 外部网卡名不匹配，例如 `eth1`。
- subnet gateway / excludeIps / externalIPs 错误。
- VPC BFD 配置缺失。
- NetworkPolicy 阻断。

### 4.7 Registry push/pull 失败

检查：

```bash
kubectl get deploy -n cpaas-system image-registry registry-gateway-gateway -o wide
kubectl get ingress -n cpaas-system
kubectl get secret -n cpaas-system registry-ssl registry-s3-secret
kubectl logs -n cpaas-system deploy/image-registry --tail=200
kubectl logs -n cpaas-system deploy/registry-gateway-gateway --tail=200
```

常见原因：

- TLS 证书不匹配。
- S3 endpoint、bucket 或凭据错误。
- ingress `proxy-body-size` 不足。
- registry/gateway 未调度到 registry 节点。
- DNS 或外部访问路径错误。

### 4.8 VictoriaMetrics / kubectl top 异常

检查：

```bash
kubectl get minfo -A | grep -i victoriametrics
kubectl get pods -n cpaas-system | grep -Ei 'victoria|vmagent|vmalert|adapter'
kubectl get pvc -n cpaas-system
kubectl top node
kubectl get --raw /apis/custom.metrics.k8s.io/v1beta1 | head
```

常见原因：

- prometheus-adapter 查询语句错误。
- vmcluster label 不匹配。
- VM 组件未 Ready。
- StorageClass/PVC 异常。

### 4.9 ClickHouse / 日志链路异常

检查：

```bash
kubectl get secret -n cpaas-system | grep -Ei 'clickhouse|syslog'
kubectl get pods -n cpaas-system -o wide | grep -Ei 'clickhouse|razor|log|vector'
kubectl get rpch -A
kubectl get minfo -A | grep -Ei 'log|clickhouse'
kubectl logs -n cpaas-system <log-component-pod> --tail=200
```

常见原因：

- ClickHouse S3 Secret 错误。
- syslog CA 未挂载。
- ResourcePatch 未生效。
- log 节点 label 缺失。
- vector 配置错误。

### 4.10 ResourcePatch 没有生效

检查：

```bash
kubectl get rpch -A
kubectl describe rpch <name> -n <namespace>
kubectl get <target-kind> <target-name> -n <namespace> -o yaml
```

常见原因：

- target label/hash 不匹配。
- 目标资源不存在。
- patch path 与当前版本资源结构不匹配。
- patch 与 operator reconciliation 冲突。

### 4.11 Etcd Backup 没有上传 S3

检查：

```bash
kubectl get etcdbackupconfiguration
kubectl describe etcdbackupconfiguration etcd-backup-default
kubectl get secret -n cpaas-system etcd-backup-s3-secret
kubectl get pods -n cpaas-system | grep -i etcd
```

验证 S3：

```bash
aws s3 --endpoint https://<s3-url> ls s3://<bucket-name>/<dir> --profile <profile> --no-verify-ssl
```

常见原因：

- S3 endpoint 不可达。
- access key / secret key 错误。
- bucket 或 region 错误。
- 控制平面节点无法访问 S3。

## 5. 回滚思路

### 5.1 低风险资源

Namespace、ConfigMap、Dashboard、Scan 等资源通常可按文件删除或重新 apply：

```bash
kubectl delete -f <file>
kubectl apply -f <previous-file>
```

### 5.2 高风险资源

以下资源不要盲目删除：

- Cluster / DCSCluster
- KubeadmControlPlane
- MachineDeployment
- MachineConfig
- Registry
- IngressNginx
- EgressGateway
- EtcdBackupConfiguration

建议先：

```bash
kubectl get <kind> <name> -n <namespace> -o yaml > backup.yaml
kubectl describe <kind> <name> -n <namespace>
```

再根据影响面回滚。

### 5.3 Helm 组件

```bash
helm history <release> -n <namespace>
helm rollback <release> <revision> -n <namespace>
```

### 5.4 Deployment 组件

```bash
kubectl rollout history deploy/<name> -n <namespace>
kubectl rollout undo deploy/<name> -n <namespace>
```

## 6. 最终验收命令

```bash
kubectl get nodes -o wide
kubectl get nodes --show-labels
kubectl get pods -A | grep -Ev 'Running|Completed'
kubectl get ingress -A
kubectl get svc -A | grep LoadBalancer
kubectl get pvc -A
kubectl get minfo -A
kubectl get rpch -A
kubectl get scan -A
kubectl get scansuite -A
kubectl get cronjob -A
```

业务/平台验收：

- [ ] ingress 域名可访问。
- [ ] registry 可 push/pull。
- [ ] egress namespace 可出网。
- [ ] VictoriaMetrics 可查询指标。
- [ ] custom.metrics API 可用。
- [ ] ClickHouse / logagent / vector 正常。
- [ ] 外部 syslog 可收到日志。
- [ ] etcd backup 文件已上传 S3。
- [ ] Zabbix proxy/agent 在线。
- [ ] Compliance scan 有结果。
- [ ] SentinelOne agent 在线。
- [ ] Heartbeat global/workload 均可访问。

## 7. 相关文档

- [[ACP Deployment 部署顺序与模块总览]]
- [[ACP 平台部署组件依赖关系]]
