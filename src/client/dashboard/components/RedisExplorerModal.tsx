import * as React from 'react';
import { useEffect, useState, useMemo, useRef } from 'react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import {
  Folder,
  ChevronRight,
  ChevronDown,
  Database,
  Copy,
  Check,
  RefreshCw,
  Search,
  Trash2,
  AlertTriangle,
  Layers,
  FileText,
  X,
  Sparkles,
} from 'lucide-react';

interface TreeNode {
  name: string;
  fullPath: string;
  isLeaf: boolean;
  totalLeafs: number;
  children: Record<string, TreeNode>;
}

export interface RedisExplorerModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUsername?: string | undefined;
}

interface DeleteTarget {
  type: 'key' | 'field' | 'member' | 'highlighted_key' | 'highlighted_field' | 'highlighted_member' | 'prefix';
  key: string;
  field?: string;
  member?: string;
  description: string;
}

export function RedisExplorerModal({
  isOpen,
  onClose,
  currentUsername,
}: RedisExplorerModalProps) {
  const [keys, setKeys] = useState<string[]>([]);
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [loadingKeys, setLoadingKeys] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedValue, setSelectedValue] = useState<{
    type: string;
    value: any;
    error?: string;
    message?: string;
  } | null>(null);
  const [loadingValue, setLoadingValue] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [fieldSearchQuery, setFieldSearchQuery] = useState('');
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedValue, setCopiedValue] = useState(false);
  const [copiedItem, setCopiedItem] = useState<string | null>(null);

  const [viewMode, setViewMode] = useState<'structured' | 'raw'>('structured');
  const [highlightedText, setHighlightedText] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const valueContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && keys.length === 0) {
      fetchKeys();
    }
  }, [isOpen]);

  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  const getHeaders = (): Record<string, string> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (currentUsername) {
      headers['x-modscope-session-id'] = currentUsername;
    }
    return headers;
  };

  const fetchKeys = async () => {
    setLoadingKeys(true);
    setFetchError(null);
    try {
      const res = await fetch('/api/utilities/redis/keys', { headers: getHeaders() });
      const rawText = await res.text();
      let body: any = null;
      try {
        body = JSON.parse(rawText);
      } catch {
        body = { status: 'error', message: rawText || `HTTP ${res.status}` };
      }

      if (res.ok && body.status === 'success' && Array.isArray(body.keys)) {
        setKeys(body.keys);
        buildTree(body.keys, expandedPaths.size === 0);
      } else {
        const errorMsg = body?.message || `Failed to fetch keys (HTTP ${res.status})`;
        setFetchError(errorMsg);
      }
    } catch (e) {
      setFetchError(String(e));
    } finally {
      setLoadingKeys(false);
    }
  };

  const calculateLeafCounts = (node: TreeNode): number => {
    const childKeys = Object.keys(node.children);
    if (childKeys.length === 0) {
      node.totalLeafs = node.isLeaf ? 1 : 0;
      return node.totalLeafs;
    }
    let count = node.isLeaf ? 1 : 0;
    for (const ck of childKeys) {
      count += calculateLeafCounts(node.children[ck]!);
    }
    node.totalLeafs = count;
    return count;
  };

  const buildTree = (allKeys: string[], autoExpandRoots: boolean = false) => {
    const root: TreeNode = { name: 'root', fullPath: '', isLeaf: false, totalLeafs: 0, children: {} };
    for (const k of allKeys) {
      const parts = k.split(':');
      let current = root;
      let pathSoFar = '';
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (!part) continue;
        pathSoFar = pathSoFar ? `${pathSoFar}:${part}` : part;
        const isLeaf = i === parts.length - 1;

        if (!current.children[part]) {
          current.children[part] = {
            name: part,
            fullPath: pathSoFar,
            isLeaf,
            totalLeafs: 0,
            children: {},
          };
        }
        current = current.children[part]!;
      }
    }
    calculateLeafCounts(root);
    setTree(root);

    // Only auto-expand top-level folders on initial load if requested
    if (autoExpandRoots) {
      const initialExpanded = new Set<string>();
      for (const child of Object.values(root.children)) {
        initialExpanded.add(child.fullPath);
      }
      setExpandedPaths(initialExpanded);
    }
  };

  const handleSelectKey = async (fullPath: string) => {
    if (!fullPath) return;
    setSelectedKey(fullPath);
    setLoadingValue(true);
    setSelectedValue(null);
    setCopiedKey(false);
    setCopiedValue(false);
    setHighlightedText('');
    setFieldSearchQuery('');

    try {
      const res = await fetch(`/api/utilities/redis/value?key=${encodeURIComponent(fullPath)}`, {
        headers: getHeaders(),
      });
      const rawText = await res.text();
      let body: any = null;
      try {
        body = JSON.parse(rawText);
      } catch {
        body = { status: 'error', message: rawText || `HTTP ${res.status}` };
      }

      if (res.ok && body.status === 'success') {
        setSelectedValue({
          type: body.type,
          value: body.value,
          message: body.message,
        });

        // Set default view mode based on data type
        if (body.type === 'hash' || body.type === 'zset' || body.type === 'set/zset' || Array.isArray(body.value)) {
          setViewMode('structured');
        } else {
          setViewMode('raw');
        }

        // If this key wasn't in discovered keys, add it
        if (!keys.includes(fullPath)) {
          const nextKeys = [...keys, fullPath].sort();
          setKeys(nextKeys);
          buildTree(nextKeys);
        }
      } else {
        setSelectedValue({
          type: 'error',
          value: null,
          error: body.message || `HTTP ${res.status}`,
        });
      }
    } catch (e) {
      setSelectedValue({
        type: 'error',
        value: null,
        error: String(e),
      });
    } finally {
      setLoadingValue(false);
    }
  };

  const executeDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);

    try {
      let res: Response;
      if (deleteTarget.type === 'key' || deleteTarget.type === 'highlighted_key' || deleteTarget.type === 'prefix') {
        const queryParams = new URLSearchParams();
        const reqBody: Record<string, string> = {};
        if (deleteTarget.type === 'prefix') {
           const prefixStr = deleteTarget.key + (deleteTarget.key.endsWith(':') ? '' : ':');
           queryParams.set('prefix', prefixStr);
           reqBody.prefix = prefixStr;
        } else {
           queryParams.set('key', deleteTarget.key);
           reqBody.key = deleteTarget.key;
        }
        res = await fetch(`/api/utilities/redis/delete-key?${queryParams.toString()}`, {
          method: 'POST',
          headers: getHeaders(),
          body: JSON.stringify(reqBody),
        });
      } else {
        const queryParams = new URLSearchParams({ key: deleteTarget.key });
        if (deleteTarget.field) queryParams.set('field', deleteTarget.field);
        if (deleteTarget.member) queryParams.set('member', deleteTarget.member);

        res = await fetch(`/api/utilities/redis/delete-entry?${queryParams.toString()}`, {
          method: 'POST',
          headers: getHeaders(),
          body: JSON.stringify({
            key: deleteTarget.key,
            field: deleteTarget.field,
            member: deleteTarget.member,
          }),
        });
      }

      const rawText = await res.text();
      let body: any = null;
      try {
        body = JSON.parse(rawText);
      } catch {
        body = { status: res.ok ? 'success' : 'error', message: rawText || `HTTP ${res.status}` };
      }

      if (res.ok && body.status === 'success') {
        setNotification({
          type: 'success',
          message: body.message || 'Deletion completed successfully.',
        });

        if (deleteTarget.type === 'key' || deleteTarget.type === 'highlighted_key') {
          // Remove deleted key from keys list
          const nextKeys = keys.filter((k) => k !== deleteTarget.key);
          setKeys(nextKeys);
          buildTree(nextKeys);

          if (selectedKey === deleteTarget.key) {
            setSelectedKey(null);
            setSelectedValue(null);
          }
        } else {
          // Sub-entry deleted, refresh current key value
          if (selectedKey) {
            handleSelectKey(selectedKey);
          }
        }
      } else {
        setNotification({
          type: 'error',
          message: body.message || `Deletion failed (HTTP ${res.status})`,
        });
      }
    } catch (err) {
      setNotification({
        type: 'error',
        message: String(err),
      });
    } finally {
      setIsDeleting(false);
      setDeleteTarget(null);
      setHighlightedText('');
    }
  };

  const toggleExpand = (path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const expandAll = () => {
    if (!tree) return;
    const all = new Set<string>();
    const collect = (node: TreeNode) => {
      if (Object.keys(node.children).length > 0) {
        all.add(node.fullPath);
        for (const child of Object.values(node.children)) {
          collect(child);
        }
      }
    };
    collect(tree);
    setExpandedPaths(all);
  };

  const collapseAll = () => {
    setExpandedPaths(new Set());
  };

  const copyToClipboard = (text: string, type: 'key' | 'value' | 'item', itemId?: string) => {
    navigator.clipboard.writeText(text);
    if (type === 'key') {
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    } else if (type === 'value') {
      setCopiedValue(true);
      setTimeout(() => setCopiedValue(false), 2000);
    } else if (type === 'item' && itemId) {
      setCopiedItem(itemId);
      setTimeout(() => setCopiedItem(null), 2000);
    }
  };

  const handleTextSelection = () => {
    const sel = window.getSelection();
    if (!sel) return;
    const text = sel.toString().trim();
    if (text && text.length > 0 && text.length < 500) {
      setHighlightedText(text);
    }
  };

  const formattedValueString = useMemo(() => {
    if (!selectedValue) return '';
    if (selectedValue.error) return `Error: ${selectedValue.error}`;
    if (selectedValue.value === null || selectedValue.value === undefined) {
      return selectedValue.message || '(nil)';
    }
    if (typeof selectedValue.value === 'string') {
      const trimmed = selectedValue.value.trim();
      if (
        (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']'))
      ) {
        try {
          return JSON.stringify(JSON.parse(trimmed), null, 2);
        } catch {
          return selectedValue.value;
        }
      }
      return selectedValue.value;
    }
    return JSON.stringify(selectedValue.value, null, 2);
  }, [selectedValue]);

  const filteredTreeChildren = useMemo(() => {
    if (!tree) return [];
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return Object.values(tree.children).sort((a, b) => a.name.localeCompare(b.name));
    }

    const filterNode = (node: TreeNode): TreeNode | null => {
      const matchesSelf =
        node.name.toLowerCase().includes(query) || node.fullPath.toLowerCase().includes(query);
      const matchingChildren: Record<string, TreeNode> = {};

      for (const [k, child] of Object.entries(node.children)) {
        const filteredChild = filterNode(child);
        if (filteredChild) {
          matchingChildren[k] = filteredChild;
        }
      }

      if (matchesSelf || Object.keys(matchingChildren).length > 0) {
        return {
          ...node,
          children: matchingChildren,
        };
      }
      return null;
    };

    const results: TreeNode[] = [];
    for (const child of Object.values(tree.children)) {
      const filtered = filterNode(child);
      if (filtered) results.push(filtered);
    }
    return results.sort((a, b) => a.name.localeCompare(b.name));
  }, [tree, searchQuery]);

  const renderNode = (node: TreeNode, depth: number = 0) => {
    const hasChildren = Object.keys(node.children).length > 0;
    const isExpanded = expandedPaths.has(node.fullPath) || searchQuery.trim().length > 0;
    const isSelected = selectedKey === node.fullPath;

    return (
      <div key={node.fullPath} className="flex flex-col">
        <div
          className={`group flex items-center gap-1.5 py-1 px-2 cursor-pointer hover:bg-muted/50 rounded-sm text-xs transition-colors ${
            isSelected ? 'bg-primary/10 text-primary font-semibold' : 'text-foreground'
          }`}
          style={{ paddingLeft: `${depth * 14 + 8}px` }}
          onClick={() => {
            if (hasChildren) toggleExpand(node.fullPath);
            if (node.isLeaf) handleSelectKey(node.fullPath);
          }}
        >
          {hasChildren ? (
            isExpanded ? (
              <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            )
          ) : (
            <div className="w-3.5 shrink-0" />
          )}
          {hasChildren ? (
            <Folder className="w-3.5 h-3.5 text-blue-500 shrink-0" />
          ) : (
            <Database className="w-3.5 h-3.5 text-purple-500 shrink-0" />
          )}
          <span className="truncate flex-1 font-mono text-[11px]">{node.name}</span>

          {/* Quick delete button on hover for leaf keys OR folders */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setDeleteTarget({
                type: node.isLeaf ? 'key' : 'prefix',
                key: node.fullPath,
                description: node.isLeaf ? `Redis key "${node.fullPath}"` : `ALL keys under folder "${node.fullPath}:" (${node.totalLeafs} keys)`,
              });
            }}
            title={node.isLeaf ? "Delete this key from Redis" : "Delete ALL keys inside this folder"}
            className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-500/20 text-muted-foreground hover:text-red-500 rounded transition-all shrink-0"
          >
            <Trash2 className="w-3 h-3" />
          </button>

          {hasChildren && node.totalLeafs > 0 && (
            <span className="text-[10px] text-muted-foreground/70 bg-muted px-1.5 py-0.2 rounded-full shrink-0">
              {node.totalLeafs}
            </span>
          )}
        </div>
        {isExpanded && hasChildren && (
          <div className="flex flex-col">
            {Object.values(node.children)
              .sort((a, b) => {
                const aHas = Object.keys(a.children).length > 0;
                const bHas = Object.keys(b.children).length > 0;
                if (aHas && !bHas) return -1;
                if (!aHas && bHas) return 1;
                return a.name.localeCompare(b.name, undefined, { numeric: true });
              })
              .map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  // Structured Hash View renderer
  const renderHashEntries = (data: Record<string, any>) => {
    const entries = Object.entries(data);
    const filter = fieldSearchQuery.trim().toLowerCase();
    const filteredEntries = filter
      ? entries.filter(
          ([k, v]) =>
            k.toLowerCase().includes(filter) ||
            String(v).toLowerCase().includes(filter)
        )
      : entries;

    return (
      <div className="flex flex-col h-full overflow-hidden">
        <div className="p-2 border-b border-border bg-muted/10 flex items-center justify-between gap-2 shrink-0">
          <div className="relative flex-1 max-w-xs">
            <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Filter fields or values..."
              value={fieldSearchQuery}
              onChange={(e) => setFieldSearchQuery(e.target.value)}
              className="w-full pl-6 pr-2 py-0.5 text-xs rounded border border-border bg-background text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <span className="text-[11px] text-muted-foreground font-mono">
            {filteredEntries.length} / {entries.length} field{entries.length !== 1 ? 's' : ''}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1 font-mono text-xs">
          {filteredEntries.length > 0 ? (
            filteredEntries.map(([field, val]) => {
              const valStr = typeof val === 'object' ? JSON.stringify(val) : String(val);
              return (
                <div
                  key={field}
                  className="group flex items-start justify-between gap-2 p-1.5 rounded border border-border/40 bg-card hover:bg-muted/30 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <span className="text-primary font-semibold select-text">{field}: </span>
                    <span className="text-foreground/90 break-all select-text">{valStr}</span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0 opacity-80 group-hover:opacity-100">
                    <button
                      onClick={() => copyToClipboard(valStr, 'item', field)}
                      title="Copy field value"
                      className="p-1 hover:bg-muted text-muted-foreground hover:text-foreground rounded"
                    >
                      {copiedItem === field ? (
                        <Check className="w-3 h-3 text-green-500" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </button>
                    <button
                      onClick={() => {
                        if (!selectedKey) return;
                        setDeleteTarget({
                          type: 'field',
                          key: selectedKey,
                          field,
                          description: `field "${field}" from hash "${selectedKey}"`,
                        });
                      }}
                      title="Delete this field from Redis hash"
                      className="p-1 hover:bg-red-500/20 text-muted-foreground hover:text-red-500 rounded transition-colors"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="p-8 text-center text-xs text-muted-foreground">
              No matching fields found.
            </div>
          )}
        </div>
      </div>
    );
  };

  // Structured ZSet / Set / List View renderer
  const renderZSetEntries = (data: any[]) => {
    const filter = fieldSearchQuery.trim().toLowerCase();
    const filteredItems = filter
      ? data.filter((item) => {
          const str = typeof item === 'string' ? item : JSON.stringify(item);
          return str.toLowerCase().includes(filter);
        })
      : data;

    return (
      <div className="flex flex-col h-full overflow-hidden">
        <div className="p-2 border-b border-border bg-muted/10 flex items-center justify-between gap-2 shrink-0">
          <div className="relative flex-1 max-w-xs">
            <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Filter members..."
              value={fieldSearchQuery}
              onChange={(e) => setFieldSearchQuery(e.target.value)}
              className="w-full pl-6 pr-2 py-0.5 text-xs rounded border border-border bg-background text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <span className="text-[11px] text-muted-foreground font-mono">
            {filteredItems.length} / {data.length} member{data.length !== 1 ? 's' : ''}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1 font-mono text-xs">
          {filteredItems.length > 0 ? (
            filteredItems.map((item, idx) => {
              const memberStr = typeof item === 'string' ? item : item?.member || JSON.stringify(item);
              const score = typeof item === 'object' && item?.score !== undefined ? item.score : undefined;
              const itemId = `item-${idx}-${memberStr.slice(0, 20)}`;

              return (
                <div
                  key={itemId}
                  className="group flex items-start justify-between gap-2 p-1.5 rounded border border-border/40 bg-card hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="text-muted-foreground text-[10px] w-6 shrink-0 font-sans">
                      #{idx + 1}
                    </span>
                    {score !== undefined && (
                      <span className="px-1.5 py-0.5 text-[10px] rounded bg-blue-500/10 text-blue-500 font-semibold shrink-0">
                        score: {score}
                      </span>
                    )}
                    <span className="text-foreground/90 break-all select-text flex-1">
                      {memberStr}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0 opacity-80 group-hover:opacity-100">
                    <button
                      onClick={() => copyToClipboard(memberStr, 'item', itemId)}
                      title="Copy member"
                      className="p-1 hover:bg-muted text-muted-foreground hover:text-foreground rounded"
                    >
                      {copiedItem === itemId ? (
                        <Check className="w-3 h-3 text-green-500" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </button>
                    <button
                      onClick={() => {
                        if (!selectedKey) return;
                        setDeleteTarget({
                          type: 'member',
                          key: selectedKey,
                          member: memberStr,
                          description: `member "${memberStr}" from "${selectedKey}"`,
                        });
                      }}
                      title="Delete this member from Redis"
                      className="p-1 hover:bg-red-500/20 text-muted-foreground hover:text-red-500 rounded transition-colors"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="p-8 text-center text-xs text-muted-foreground">
              No matching members found.
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[94vw] w-[1360px] h-[90vh] flex flex-col p-0 gap-0 overflow-hidden shadow-2xl border border-border">
        <DialogHeader className="p-4 border-b border-border shrink-0 bg-card">
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2 text-base font-bold">
              <Database className="w-5 h-5 text-primary" />
              Redis Storage Explorer
            </DialogTitle>
          </div>
        </DialogHeader>

        {/* Global Notification Banner */}
        {notification && (
          <div
            className={`px-4 py-2 text-xs flex items-center justify-between shrink-0 font-medium ${
              notification.type === 'success'
                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-b border-emerald-500/20'
                : 'bg-red-500/10 text-red-600 dark:text-red-400 border-b border-red-500/20'
            }`}
          >
            <span>{notification.message}</span>
            <button
              onClick={() => setNotification(null)}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <div className="flex flex-1 overflow-hidden min-h-0">
          {/* LEFT: Tree View & Search */}
          <div className="w-5/12 border-r border-border flex flex-col bg-card/40 min-w-0">
            {/* Search and Direct Lookup Bar */}
            <div className="p-2 border-b border-border flex gap-1.5 bg-muted/20 shrink-0">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Filter or enter exact key name..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && searchQuery.trim()) {
                      handleSelectKey(searchQuery.trim());
                    }
                  }}
                  className="w-full pl-8 pr-2 py-1 text-xs rounded border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary font-mono"
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => searchQuery.trim() && handleSelectKey(searchQuery.trim())}
                disabled={!searchQuery.trim()}
                className="h-7 text-xs px-2 shrink-0 font-medium"
                title="Directly inspect this key in Redis"
              >
                Inspect
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={() => {
                  if (searchQuery.trim()) {
                    setDeleteTarget({
                      type: 'key',
                      key: searchQuery.trim(),
                      description: `Redis key "${searchQuery.trim()}"`,
                    });
                  }
                }}
                disabled={!searchQuery.trim()}
                className="h-7 text-xs px-2 shrink-0 font-medium"
                title="Delete this key directly from Redis"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>

            {/* Tree Controls Header */}
            <div className="px-3 py-1.5 border-b border-border flex items-center justify-between shrink-0 bg-muted/10 text-xs">
              <span className="font-semibold text-muted-foreground uppercase tracking-wider text-[11px]">
                Discovered Keys ({keys.length})
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={expandAll}
                  className="text-[11px] text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded hover:bg-muted"
                >
                  Expand All
                </button>
                <span className="text-muted-foreground/40">|</span>
                <button
                  onClick={collapseAll}
                  className="text-[11px] text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded hover:bg-muted"
                >
                  Collapse
                </button>
                <span className="text-muted-foreground/40">|</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={fetchKeys}
                  disabled={loadingKeys}
                  className="h-6 px-1.5 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
                >
                  <RefreshCw className={`w-3 h-3 ${loadingKeys ? 'animate-spin' : ''}`} />
                  Refresh
                </Button>
              </div>
            </div>

            {/* Error Message Alert */}
            {fetchError && (
              <div className="p-3 m-2 text-xs bg-red-500/10 border border-red-500/30 text-red-500 rounded flex flex-col gap-1.5 shrink-0">
                <div className="font-semibold">Failed to enumerate Redis keys</div>
                <div className="text-[11px] font-mono break-all">{fetchError}</div>
                <Button variant="outline" size="sm" onClick={fetchKeys} className="mt-1 h-6 text-xs w-fit">
                  Retry Scan
                </Button>
              </div>
            )}

            {/* Tree Area */}
            <div className="flex-1 overflow-y-auto p-1.5 select-none font-mono">
              {loadingKeys ? (
                <div className="p-8 text-xs text-muted-foreground text-center flex flex-col items-center gap-2">
                  <RefreshCw className="w-5 h-5 animate-spin text-primary" />
                  Scanning Redis keys and building storage tree...
                </div>
              ) : filteredTreeChildren.length > 0 ? (
                filteredTreeChildren.map((child) => renderNode(child, 0))
              ) : (
                <div className="p-8 text-xs text-muted-foreground text-center">
                  {searchQuery ? 'No matching keys found.' : 'No keys discovered.'}
                </div>
              )}
            </div>
          </div>

          {/* RIGHT: Values Area */}
          <div
            ref={valueContainerRef}
            onMouseUp={handleTextSelection}
            onKeyUp={handleTextSelection}
            className="flex-1 flex flex-col bg-background min-w-0"
          >
            {/* Header bar */}
            <div className="p-2.5 border-b border-border shrink-0 bg-muted/20 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider shrink-0">
                  {selectedKey ? 'Key:' : 'Select a key'}
                </span>
                {selectedKey && (
                  <span className="text-xs font-mono font-medium text-foreground truncate select-all" title={selectedKey}>
                    {selectedKey}
                  </span>
                )}
                {selectedValue?.type && (
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-mono tracking-wider font-semibold uppercase shrink-0 ${
                      selectedValue.type === 'hash'
                        ? 'bg-purple-500/10 text-purple-500 border border-purple-500/20'
                        : selectedValue.type === 'zset' || selectedValue.type === 'set/zset'
                        ? 'bg-blue-500/10 text-blue-500 border border-blue-500/20'
                        : selectedValue.type === 'string'
                        ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
                        : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {selectedValue.type}
                  </span>
                )}
              </div>

              {selectedKey && (
                <div className="flex items-center gap-1.5 shrink-0">
                  {/* View Mode Switcher */}
                  {(selectedValue?.type === 'hash' ||
                    selectedValue?.type === 'zset' ||
                    selectedValue?.type === 'set/zset' ||
                    Array.isArray(selectedValue?.value)) && (
                    <div className="flex items-center bg-muted/60 p-0.5 rounded border border-border mr-1">
                      <button
                        onClick={() => setViewMode('structured')}
                        className={`px-2 py-0.5 text-[11px] rounded transition-colors flex items-center gap-1 font-medium ${
                          viewMode === 'structured'
                            ? 'bg-background text-foreground shadow-sm'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                        title="Structured View"
                      >
                        <Layers className="w-3 h-3" />
                        Table
                      </button>
                      <button
                        onClick={() => setViewMode('raw')}
                        className={`px-2 py-0.5 text-[11px] rounded transition-colors flex items-center gap-1 font-medium ${
                          viewMode === 'raw'
                            ? 'bg-background text-foreground shadow-sm'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                        title="Raw Text View"
                      >
                        <FileText className="w-3 h-3" />
                        Raw
                      </button>
                    </div>
                  )}

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => selectedKey && copyToClipboard(selectedKey, 'key')}
                    className="h-6 px-2 text-[11px] gap-1"
                  >
                    {copiedKey ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                    {copiedKey ? 'Copied' : 'Copy Key'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => formattedValueString && copyToClipboard(formattedValueString, 'value')}
                    disabled={!formattedValueString}
                    className="h-6 px-2 text-[11px] gap-1"
                  >
                    {copiedValue ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                    {copiedValue ? 'Copied' : 'Copy Value'}
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => {
                      if (!selectedKey) return;
                      setDeleteTarget({
                        type: 'key',
                        key: selectedKey,
                        description: `Redis key "${selectedKey}"`,
                      });
                    }}
                    className="h-6 px-2 text-[11px] gap-1 font-semibold"
                    title="Delete this entire key from Redis"
                  >
                    <Trash2 className="w-3 h-3" />
                    Delete Key
                  </Button>
                </div>
              )}
            </div>

            {/* Highlighted text action banner */}
            {highlightedText && (
              <div className="bg-primary/10 border-b border-primary/20 px-3 py-1.5 flex items-center justify-between gap-2 shrink-0 animate-in fade-in duration-150">
                <div className="flex items-center gap-1.5 min-w-0 text-xs">
                  <Sparkles className="w-3.5 h-3.5 text-primary shrink-0" />
                  <span className="text-muted-foreground">Highlighted:</span>
                  <span className="font-mono font-semibold text-foreground truncate max-w-sm">
                    "{highlightedText}"
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => {
                      setDeleteTarget({
                        type: 'highlighted_key',
                        key: highlightedText,
                        description: `Redis key "${highlightedText}"`,
                      });
                    }}
                    className="h-6 px-2 text-[11px] gap-1"
                  >
                    <Trash2 className="w-3 h-3" />
                    Delete Key
                  </Button>

                  {selectedValue?.type === 'hash' && selectedKey && (
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => {
                        setDeleteTarget({
                          type: 'highlighted_field',
                          key: selectedKey,
                          field: highlightedText,
                          description: `field "${highlightedText}" from hash "${selectedKey}"`,
                        });
                      }}
                      className="h-6 px-2 text-[11px] gap-1"
                    >
                      <Trash2 className="w-3 h-3" />
                      Delete Field
                    </Button>
                  )}

                  {(selectedValue?.type === 'zset' || selectedValue?.type === 'set/zset') && selectedKey && (
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => {
                        setDeleteTarget({
                          type: 'highlighted_member',
                          key: selectedKey,
                          member: highlightedText,
                          description: `member "${highlightedText}" from "${selectedKey}"`,
                        });
                      }}
                      className="h-6 px-2 text-[11px] gap-1"
                    >
                      <Trash2 className="w-3 h-3" />
                      Delete Member
                    </Button>
                  )}

                  <button
                    onClick={() => setHighlightedText('')}
                    className="text-muted-foreground hover:text-foreground p-1"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}

            {/* Value Body View */}
            <div className="flex-1 overflow-hidden flex flex-col min-h-0">
              {loadingValue ? (
                <div className="h-full flex items-center justify-center text-xs text-muted-foreground flex-col gap-2">
                  <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  Fetching value from Redis...
                </div>
              ) : selectedKey ? (
                viewMode === 'structured' && selectedValue?.type === 'hash' && selectedValue?.value && typeof selectedValue.value === 'object' ? (
                  renderHashEntries(selectedValue.value)
                ) : viewMode === 'structured' && (selectedValue?.type === 'zset' || selectedValue?.type === 'set/zset' || Array.isArray(selectedValue?.value)) && Array.isArray(selectedValue.value) ? (
                  renderZSetEntries(selectedValue.value)
                ) : (
                  <div className="flex-1 p-3 overflow-hidden flex flex-col">
                    <textarea
                      readOnly
                      className="w-full h-full p-3 font-mono text-xs bg-muted/20 border border-border rounded-md resize-none focus:outline-none focus:ring-1 focus:ring-primary/40 leading-relaxed text-foreground select-text"
                      value={formattedValueString}
                      onSelect={(e) => {
                        const target = e.target as HTMLTextAreaElement;
                        const sel = target.value.substring(target.selectionStart, target.selectionEnd).trim();
                        if (sel && sel.length > 0 && sel.length < 500) {
                          setHighlightedText(sel);
                        }
                      }}
                    />
                  </div>
                )
              ) : (
                <div className="h-full flex items-center justify-center text-muted-foreground text-xs flex-col gap-2">
                  <Database className="w-10 h-10 text-muted-foreground/20" />
                  <span>Select any leaf key in the tree or inspect a key above to view its contents</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Confirmation Modal for Deletion */}
        {deleteTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-100">
            <div className="bg-card border border-border rounded-lg shadow-2xl max-w-md w-full p-4 flex flex-col gap-3">
              <div className="flex items-center gap-2.5 text-red-500 font-bold text-sm">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                Confirm Redis Deletion
              </div>
              <p className="text-xs text-foreground/90 leading-relaxed">
                Are you sure you want to permanently delete {deleteTarget.description} from Redis?
              </p>
              <div className="p-2 rounded bg-muted/50 border border-border font-mono text-[11px] text-foreground break-all max-h-24 overflow-y-auto">
                {deleteTarget.field ? (
                  <div>
                    <span className="text-muted-foreground">Key: </span>{deleteTarget.key}
                    <br />
                    <span className="text-primary font-semibold">Field: </span>{deleteTarget.field}
                  </div>
                ) : deleteTarget.member ? (
                  <div>
                    <span className="text-muted-foreground">Key: </span>{deleteTarget.key}
                    <br />
                    <span className="text-primary font-semibold">Member: </span>{deleteTarget.member}
                  </div>
                ) : (
                  <div>
                    <span className="text-muted-foreground">Key: </span>{deleteTarget.key}
                  </div>
                )}
              </div>
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDeleteTarget(null)}
                  disabled={isDeleting}
                  className="text-xs h-8"
                >
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={executeDelete}
                  loading={isDeleting}
                  className="text-xs h-8 font-semibold"
                >
                  Confirm Delete
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
