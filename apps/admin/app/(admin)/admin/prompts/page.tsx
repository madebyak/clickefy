'use client';

/**
 * Prompts — the hidden texts behind one-click features, editable here.
 *
 * Today: the One-Click Ad's director brief. Edit, preview exactly what
 * the model will receive for a given number of images and note, save
 * with a note, restore any earlier version, or go back to the code
 * default. Saves take effect within a minute (the API caches the text).
 */

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, History, RotateCcw, Save } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { fetchPrompt, fetchPrompts, previewPrompt, resetPrompt, savePrompt } from '@/lib/api/prompts';

export default function PromptsPage() {
  const { getToken } = useAuth();
  const tokenGetter = useMemo(() => () => getToken(), [getToken]);
  const list = useQuery({ queryKey: ['admin', 'prompts'], queryFn: () => fetchPrompts(tokenGetter) });
  const [key, setKey] = useState<string>('ad_brief');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Prompts</h1>
          <p className="mt-1 text-muted-foreground">The hidden texts behind one-click features. Changes apply within a minute, no deploy needed.</p>
        </div>
        {list.data && list.data.length > 1 && (
          <Select value={key} onValueChange={(v) => setKey(v as string)}>
            <SelectTrigger className="w-72"><SelectValue>{(v) => list.data?.find((p) => p.key === v)?.title ?? 'Prompt'}</SelectValue></SelectTrigger>
            <SelectContent>{list.data.map((p) => <SelectItem key={p.key} value={p.key}>{p.title}</SelectItem>)}</SelectContent>
          </Select>
        )}
      </div>
      <PromptEditor key={key} promptKey={key} tokenGetter={tokenGetter} />
    </div>
  );
}

function PromptEditor({ promptKey, tokenGetter }: { promptKey: string; tokenGetter: () => Promise<string | null> }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['admin', 'prompts', promptKey], queryFn: () => fetchPrompt(tokenGetter, promptKey) });
  const [body, setBody] = useState('');
  const [note, setNote] = useState('');
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  useEffect(() => {
    if (data && loadedFor !== data.key + data.versions.length) {
      setBody(data.body);
      setLoadedFor(data.key + data.versions.length);
    }
  }, [data, loadedFor]);
  const dirty = data != null && body !== data.body;
  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'prompts', promptKey] });

  const save = useMutation({
    mutationFn: () => savePrompt(tokenGetter, promptKey, body, note.trim() || undefined),
    onSuccess: () => { toast.success('Saved. Live within a minute.'); setNote(''); invalidate(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not save'),
  });
  const reset = useMutation({
    mutationFn: () => resetPrompt(tokenGetter, promptKey),
    onSuccess: () => { toast.success('Back to the code default.'); invalidate(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not reset'),
  });

  // Preview
  const [previewOpen, setPreviewOpen] = useState(false);
  const [imageCount, setImageCount] = useState(1);
  const [previewNotes, setPreviewNotes] = useState('');
  const preview = useMutation({
    mutationFn: () => previewPrompt(tokenGetter, promptKey, { body, imageCount, notes: previewNotes || undefined }),
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not render'),
  });
  const [history, setHistory] = useState(false);

  if (isLoading || !data) return <Skeleton className="h-96 rounded-lg" />;

  const missing = data.placeholders.filter((p) => !body.includes(p.token));

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              {data.title}
              <Badge variant={data.isDefault ? 'secondary' : 'default'}>{data.isDefault ? 'code default' : 'customised'}</Badge>
            </CardTitle>
            <CardDescription className="mt-1 max-w-2xl">{data.description}</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => { setPreviewOpen(true); preview.mutate(); }}><Eye className="mr-1.5 h-4 w-4" />Preview</Button>
            <Button variant="outline" size="sm" onClick={() => setHistory((v) => !v)}><History className="mr-1.5 h-4 w-4" />History ({data.versions.length})</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            spellCheck={false}
            className="min-h-[520px] font-mono text-xs leading-relaxed"
          />
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className={body.length > data.maxChars ? 'text-destructive' : ''}>{body.length.toLocaleString()} / {data.maxChars.toLocaleString()} characters</span>
            {missing.length > 0 && <span className="text-warning">Not used: {missing.map((m) => m.token).join(' ')}</span>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What changed (optional)" className="max-w-sm" />
            <Button onClick={() => save.mutate()} disabled={!dirty || save.isPending || body.length > data.maxChars || body.trim().length < 50}>
              <Save className="mr-1.5 h-4 w-4" />{save.isPending ? 'Saving…' : 'Save'}
            </Button>
            {dirty && <Button variant="ghost" onClick={() => setBody(data.body)}>Discard</Button>}
            {!data.isDefault && (
              <Button variant="ghost" className="ml-auto text-destructive" onClick={() => { if (confirm('Replace the saved text with the code default?')) reset.mutate(); }}>
                <RotateCcw className="mr-1.5 h-4 w-4" />Reset to default
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="space-y-6">
        <Card>
          <CardHeader><CardDescription className="text-sm font-medium">Placeholders</CardDescription></CardHeader>
          <CardContent className="space-y-2 text-xs">
            {data.placeholders.map((p) => (
              <div key={p.token}><code className="rounded bg-muted px-1 py-0.5">{p.token}</code> <span className="text-muted-foreground">{p.meaning}</span></div>
            ))}
            <p className="pt-2 text-muted-foreground">The user&apos;s note is appended by the server as <code className="rounded bg-muted px-1">Important Note: &quot;…&quot;</code> when they wrote one.</p>
          </CardContent>
        </Card>
        {history && (
          <Card>
            <CardHeader><CardDescription className="text-sm font-medium">History</CardDescription></CardHeader>
            <CardContent className="space-y-2">
              {data.versions.length === 0 ? (
                <p className="text-xs text-muted-foreground">No saves yet.</p>
              ) : (
                data.versions.map((v) => (
                  <div key={v.id} className="rounded-md border border-border p-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">{new Date(v.createdAt).toLocaleString('en-GB', { timeZone: 'Asia/Dubai' })}</span>
                      <Button variant="ghost" size="xs" onClick={() => setBody(v.body)}>Load</Button>
                    </div>
                    {v.note && <div className="mt-1">{v.note}</div>}
                    <div className="mt-1 truncate text-muted-foreground">{v.body.slice(0, 90)}…</div>
                  </div>
                ))
              )}
              <p className="text-[10px] text-muted-foreground">Load puts that text in the editor; Save makes it current.</p>
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>What the model receives</DialogTitle>
            <DialogDescription>Rendered from the editor&apos;s current text, before any save.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label>Images</Label>
              <Select value={String(imageCount)} onValueChange={(v) => setImageCount(Number(v))}>
                <SelectTrigger className="w-24"><SelectValue>{(v) => String(v)}</SelectValue></SelectTrigger>
                <SelectContent>{[1, 2, 3, 4, 5].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex-1 space-y-1">
              <Label>User note (optional)</Label>
              <Input value={previewNotes} onChange={(e) => setPreviewNotes(e.target.value)} placeholder="e.g. luxury perfume for women, show it by the sea" />
            </div>
            <Button variant="outline" onClick={() => preview.mutate()} disabled={preview.isPending}>Render</Button>
          </div>
          <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 font-mono text-xs">{preview.data?.rendered ?? (preview.isPending ? 'Rendering…' : '')}</pre>
          {preview.data && <p className="text-xs text-muted-foreground">{preview.data.chars.toLocaleString()} characters</p>}
          <DialogFooter><Button variant="outline" onClick={() => setPreviewOpen(false)}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
