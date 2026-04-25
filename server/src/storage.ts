import fs from 'node:fs';
import path from 'node:path';
import type { ProjectRecord } from './types.js';
import { ensureDir, safeRemoveDir, sanitizeSegment, toUnixPath } from './utils.js';

export type TrashRetentionCategory = 'originals' | 'previews' | 'hdr' | 'results' | 'staging';

export interface TrashRetentionEntry {
  category: TrashRetentionCategory;
  relativePath: string;
  retentionDays: number;
  deleteAfter: string;
  trashPath?: string;
  sourcePath?: string;
  label?: string;
}

export interface TrashArchiveResult {
  trashRoot: string;
  manifestPath: string;
  deletedAt: string;
  entries: TrashRetentionEntry[];
  pending?: boolean;
}

export interface TrashFileInput {
  absolutePath: string | null | undefined;
  category: TrashRetentionCategory;
  retentionDays: number;
  label?: string;
}

interface StorageFolderNames {
  originals: string;
  previews: string;
  hdr: string;
  results: string;
  staging: string;
}

interface LegacyStorageFolderNames {
  originals: string;
  previews: string;
  hdr: string;
  results: string;
}

export interface ProjectDirectories {
  projectRoot: string;
  originals: string;
  previews: string;
  hdr: string;
  results: string;
  staging: string;
}

export interface StorageProvider {
  getRoot(): string;
  getInfo(): { provider: string; root: string };
  toStorageKey(absolutePath: string): string;
  resolveStoragePath(storageKey: string): string;
  toPublicUrlFromKey(storageKey: string): string;
  toPublicUrl(absolutePath: string): string;
  getProjectDirectories(projectOrUserKey: ProjectRecord | string, projectId?: string): ProjectDirectories;
  ensureProjectDirectories(project: ProjectRecord): ProjectDirectories;
  listProjectOriginals(project: ProjectRecord): string[];
  listProjectStagedFiles(project: ProjectRecord): string[];
  trashProjectRoot(project: ProjectRecord, retentionDays: Record<TrashRetentionCategory, number>): TrashArchiveResult | null;
  trashFiles(project: ProjectRecord, files: TrashFileInput[], reason: string): TrashArchiveResult | null;
  cleanupExpiredTrash(now?: Date): { manifests: number; removedPaths: number };
}

interface LocalDiskStorageProviderOptions {
  storageRoot: string;
  folderNames: StorageFolderNames;
  legacyFolderNames: LegacyStorageFolderNames;
}

export class LocalDiskStorageProvider implements StorageProvider {
  constructor(
    private readonly storageRoot: string,
    private readonly folderNames: StorageFolderNames,
    private readonly legacyFolderNames: LegacyStorageFolderNames
  ) {
    ensureDir(this.storageRoot);
  }

  getRoot() {
    return this.storageRoot;
  }

  getInfo() {
    return { provider: 'local-disk' as const, root: this.storageRoot };
  }

  toStorageKey(absolutePath: string) {
    const relative = path.relative(this.storageRoot, absolutePath);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`Storage path is outside the configured storage root: ${absolutePath}`);
    }
    return toUnixPath(relative);
  }

  resolveStoragePath(storageKey: string) {
    return path.join(this.storageRoot, ...storageKey.split('/').filter(Boolean));
  }

  toPublicUrlFromKey(storageKey: string) {
    return `/storage/${toUnixPath(storageKey)}`;
  }

  toPublicUrl(absolutePath: string) {
    return this.toPublicUrlFromKey(this.toStorageKey(absolutePath));
  }

  getProjectDirectories(projectOrUserKey: ProjectRecord | string, projectId?: string): ProjectDirectories {
    const userKey = typeof projectOrUserKey === 'string' ? projectOrUserKey : projectOrUserKey.userKey;
    const resolvedProjectId = typeof projectOrUserKey === 'string' ? (projectId as string) : projectOrUserKey.id;
    const projectRoot = path.join(this.storageRoot, sanitizeSegment(userKey), resolvedProjectId);
    return {
      projectRoot,
      originals: path.join(projectRoot, this.folderNames.originals),
      previews: path.join(projectRoot, this.folderNames.previews),
      hdr: path.join(projectRoot, this.folderNames.hdr),
      results: path.join(projectRoot, this.folderNames.results),
      staging: path.join(projectRoot, this.folderNames.staging)
    };
  }

  ensureProjectDirectories(project: ProjectRecord) {
    const dirs = this.getProjectDirectories(project);
    ensureDir(dirs.projectRoot);
    this.migrateLegacyProjectDirectories(dirs.projectRoot);
    ensureDir(dirs.originals);
    ensureDir(dirs.previews);
    ensureDir(dirs.hdr);
    ensureDir(dirs.results);
    ensureDir(dirs.staging);
    return dirs;
  }

  listProjectOriginals(project: ProjectRecord) {
    const dirs = this.ensureProjectDirectories(project);
    if (!fs.existsSync(dirs.originals)) {
      return [] as string[];
    }

    return fs
      .readdirSync(dirs.originals)
      .map((name) => path.join(dirs.originals, name))
      .filter((filePath) => fs.statSync(filePath).isFile())
      .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
  }

  listProjectStagedFiles(project: ProjectRecord) {
    const dirs = this.ensureProjectDirectories(project);
    if (!fs.existsSync(dirs.staging)) {
      return [] as string[];
    }

    return this.listFilesRecursively(dirs.staging);
  }

  trashProjectRoot(project: ProjectRecord, retentionDays: Record<TrashRetentionCategory, number>) {
    const dirs = this.getProjectDirectories(project);
    if (!fs.existsSync(dirs.projectRoot)) {
      return null;
    }

    const sourceRelativePath = this.requireStorageRelativePath(dirs.projectRoot);
    const deletedAt = new Date().toISOString();
    const trashRoot = this.createUniqueTrashPath(
      'projects',
      `${this.formatTrashTimestamp(deletedAt)}_${sanitizeSegment(project.userKey)}_${sanitizeSegment(project.id)}`
    );

    const entries: TrashRetentionEntry[] = [
      this.createFolderRetentionEntry('originals', this.folderNames.originals, retentionDays.originals, deletedAt),
      this.createFolderRetentionEntry('previews', this.folderNames.previews, retentionDays.previews, deletedAt),
      this.createFolderRetentionEntry('hdr', this.folderNames.hdr, retentionDays.hdr, deletedAt),
      this.createFolderRetentionEntry('staging', this.folderNames.staging, retentionDays.staging, deletedAt),
      this.createFolderRetentionEntry('results', this.folderNames.results, retentionDays.results, deletedAt)
    ];

    ensureDir(path.dirname(trashRoot));
    try {
      fs.renameSync(dirs.projectRoot, trashRoot);
    } catch (error) {
      const pendingManifestPath = this.writePendingProjectTrashManifest({
        deletedAt,
        sourceRelativePath,
        sourceProjectRoot: dirs.projectRoot,
        trashRoot,
        project,
        entries,
        error
      });
      return { trashRoot, manifestPath: pendingManifestPath, deletedAt, entries, pending: true };
    }

    const manifestPath = path.join(trashRoot, '.metrovan-trash-manifest.json');
    this.writeProjectTrashManifest(manifestPath, {
      deletedAt,
      sourceRelativePath,
      sourceProjectRoot: dirs.projectRoot,
      trashRoot,
      project,
      entries
    });

    return { trashRoot, manifestPath, deletedAt, entries };
  }

  trashFiles(project: ProjectRecord, files: TrashFileInput[], reason: string) {
    const deduped = new Map<string, TrashFileInput>();
    for (const file of files) {
      if (!file.absolutePath || !fs.existsSync(file.absolutePath)) {
        continue;
      }

      const resolvedPath = path.resolve(file.absolutePath);
      const existing = deduped.get(resolvedPath);
      if (!existing || file.retentionDays > existing.retentionDays) {
        deduped.set(resolvedPath, { ...file, absolutePath: resolvedPath });
      }
    }

    if (!deduped.size) {
      return null;
    }

    const deletedAt = new Date().toISOString();
    const trashRoot = this.createUniqueTrashPath(
      'files',
      `${this.formatTrashTimestamp(deletedAt)}_${sanitizeSegment(project.userKey)}_${sanitizeSegment(project.id)}_${sanitizeSegment(reason)}`
    );
    ensureDir(trashRoot);

    const entries: TrashRetentionEntry[] = [];
    for (const file of deduped.values()) {
      const sourcePath = path.resolve(file.absolutePath as string);
      const sourceRelativePath = this.requireStorageRelativePath(sourcePath);
      const trashPath = path.join(trashRoot, ...sourceRelativePath.split(path.sep));
      ensureDir(path.dirname(trashPath));
      fs.renameSync(sourcePath, trashPath);
      entries.push({
        category: file.category,
        relativePath: toUnixPath(sourceRelativePath),
        retentionDays: file.retentionDays,
        deleteAfter: this.addDaysIso(deletedAt, file.retentionDays),
        trashPath,
        sourcePath,
        label: file.label
      });
    }

    const manifestPath = path.join(trashRoot, '.metrovan-trash-manifest.json');
    fs.writeFileSync(
      manifestPath,
      JSON.stringify(
        {
          version: 1,
          kind: 'file-set',
          deletedAt,
          trashRoot,
          project: {
            id: project.id,
            userKey: project.userKey,
            name: project.name
          },
          reason,
          entries
        },
        null,
        2
      ),
      'utf8'
    );

    return { trashRoot, manifestPath, deletedAt, entries };
  }

  cleanupExpiredTrash(now = new Date()) {
    const trashRoot = this.getTrashRoot();
    if (!fs.existsSync(trashRoot)) {
      return { manifests: 0, removedPaths: 0 };
    }

    this.retryPendingProjectTrash();

    let manifests = 0;
    let removedPaths = 0;
    const manifestPaths = this.listFilesRecursively(trashRoot).filter((filePath) =>
      path.basename(filePath).toLowerCase() === '.metrovan-trash-manifest.json'
    );

    for (const manifestPath of manifestPaths) {
      const manifest = this.readTrashManifest(manifestPath);
      if (!manifest) {
        continue;
      }

      manifests += 1;
      const manifestTrashRoot = this.resolveManifestTrashRoot(manifestPath, manifest.trashRoot);
      if (!manifestTrashRoot || !this.isPathInside(manifestTrashRoot, trashRoot)) {
        continue;
      }

      const entries = this.normalizeManifestEntries(manifest.entries);
      if (!entries.length) {
        continue;
      }

      const nowMs = now.getTime();
      const allExpired = entries.every((entry) => Date.parse(entry.deleteAfter) <= nowMs);
      if (allExpired) {
        safeRemoveDir(manifestTrashRoot);
        removedPaths += 1;
        continue;
      }

      for (const entry of entries) {
        if (Date.parse(entry.deleteAfter) > nowMs) {
          continue;
        }

        const targetPath =
          typeof entry.trashPath === 'string'
            ? path.resolve(entry.trashPath)
            : path.join(manifestTrashRoot, ...entry.relativePath.split('/').filter(Boolean));
        if (!this.isPathInside(targetPath, manifestTrashRoot)) {
          continue;
        }

        this.removePathIfExists(targetPath);
        removedPaths += 1;
      }
    }

    return { manifests, removedPaths };
  }

  private writeProjectTrashManifest(
    manifestPath: string,
    input: {
      deletedAt: string;
      sourceRelativePath: string;
      sourceProjectRoot: string;
      trashRoot: string;
      project: ProjectRecord;
      entries: TrashRetentionEntry[];
    }
  ) {
    fs.writeFileSync(
      manifestPath,
      JSON.stringify(
        {
          version: 1,
          kind: 'project-root',
          deletedAt: input.deletedAt,
          sourceRelativePath: toUnixPath(input.sourceRelativePath),
          sourceProjectRoot: input.sourceProjectRoot,
          trashRoot: input.trashRoot,
          project: {
            id: input.project.id,
            userKey: input.project.userKey,
            name: input.project.name,
            createdAt: input.project.createdAt,
            updatedAt: input.project.updatedAt
          },
          entries: input.entries
        },
        null,
        2
      ),
      'utf8'
    );
  }

  private writePendingProjectTrashManifest(input: {
    deletedAt: string;
    sourceRelativePath: string;
    sourceProjectRoot: string;
    trashRoot: string;
    project: ProjectRecord;
    entries: TrashRetentionEntry[];
    error?: unknown;
  }) {
    const pendingRoot = this.createUniqueTrashPath(
      'pending-projects',
      `${this.formatTrashTimestamp(input.deletedAt)}_${sanitizeSegment(input.project.userKey)}_${sanitizeSegment(input.project.id)}`
    );
    ensureDir(pendingRoot);
    const manifestPath = path.join(pendingRoot, '.metrovan-pending-project-trash.json');
    fs.writeFileSync(
      manifestPath,
      JSON.stringify(
        {
          version: 1,
          kind: 'pending-project-root',
          deletedAt: input.deletedAt,
          sourceRelativePath: toUnixPath(input.sourceRelativePath),
          sourceProjectRoot: input.sourceProjectRoot,
          trashRoot: input.trashRoot,
          project: {
            id: input.project.id,
            userKey: input.project.userKey,
            name: input.project.name,
            createdAt: input.project.createdAt,
            updatedAt: input.project.updatedAt
          },
          entries: input.entries,
          lastError: input.error instanceof Error ? input.error.message : input.error ? String(input.error) : null,
          lastAttemptAt: new Date().toISOString()
        },
        null,
        2
      ),
      'utf8'
    );
    return manifestPath;
  }

  private retryPendingProjectTrash() {
    const trashRoot = this.getTrashRoot();
    const pendingManifests = this.listFilesRecursively(trashRoot).filter((filePath) =>
      path.basename(filePath).toLowerCase() === '.metrovan-pending-project-trash.json'
    );

    for (const pendingManifestPath of pendingManifests) {
      const manifest = this.readTrashManifest(pendingManifestPath) as
        | {
            kind?: unknown;
            deletedAt?: unknown;
            sourceRelativePath?: unknown;
            sourceProjectRoot?: unknown;
            trashRoot?: unknown;
            project?: unknown;
            entries?: unknown;
          }
        | null;
      if (!manifest || manifest.kind !== 'pending-project-root') {
        continue;
      }

      const sourceProjectRoot =
        typeof manifest.sourceProjectRoot === 'string' ? path.resolve(manifest.sourceProjectRoot) : '';
      const targetTrashRoot = typeof manifest.trashRoot === 'string' ? path.resolve(manifest.trashRoot) : '';
      if (
        !sourceProjectRoot ||
        !targetTrashRoot ||
        !this.isPathInside(sourceProjectRoot, this.storageRoot) ||
        !this.isPathInside(targetTrashRoot, trashRoot)
      ) {
        continue;
      }

      if (!fs.existsSync(sourceProjectRoot)) {
        safeRemoveDir(path.dirname(pendingManifestPath));
        continue;
      }

      const entries = this.normalizeManifestEntries(manifest.entries);
      if (!entries.length) {
        continue;
      }

      try {
        ensureDir(path.dirname(targetTrashRoot));
        fs.renameSync(sourceProjectRoot, targetTrashRoot);
        this.writeProjectTrashManifest(path.join(targetTrashRoot, '.metrovan-trash-manifest.json'), {
          deletedAt: typeof manifest.deletedAt === 'string' ? manifest.deletedAt : new Date().toISOString(),
          sourceRelativePath:
            typeof manifest.sourceRelativePath === 'string' ? manifest.sourceRelativePath : sourceProjectRoot,
          sourceProjectRoot,
          trashRoot: targetTrashRoot,
          project: this.normalizeTrashProjectRecord(manifest.project),
          entries
        });
        safeRemoveDir(path.dirname(pendingManifestPath));
      } catch (error) {
        this.updatePendingTrashError(pendingManifestPath, manifest, error);
      }
    }
  }

  private normalizeTrashProjectRecord(project: unknown): ProjectRecord {
    const value = project && typeof project === 'object' ? (project as Partial<ProjectRecord>) : {};
    const now = new Date().toISOString();
    return {
      id: typeof value.id === 'string' ? value.id : 'unknown',
      userKey: typeof value.userKey === 'string' ? value.userKey : 'unknown',
      userDisplayName: typeof value.userDisplayName === 'string' ? value.userDisplayName : '',
      name: typeof value.name === 'string' ? value.name : 'Deleted project',
      address: '',
      status: 'failed',
      currentStep: 1,
      pointsEstimate: 0,
      pointsSpent: 0,
      photoCount: 0,
      groupCount: 0,
      downloadReady: false,
      createdAt: typeof value.createdAt === 'string' ? value.createdAt : now,
      updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : now,
      hdrItems: [],
      groups: [],
      resultAssets: [],
      job: null
    };
  }

  private updatePendingTrashError(
    pendingManifestPath: string,
    manifest: Record<string, unknown>,
    error: unknown
  ) {
    try {
      fs.writeFileSync(
        pendingManifestPath,
        JSON.stringify(
          {
            ...manifest,
            lastError: error instanceof Error ? error.message : String(error),
            lastAttemptAt: new Date().toISOString()
          },
          null,
          2
        ),
        'utf8'
      );
    } catch {
      // Keep the original pending manifest if error details cannot be updated.
    }
  }

  private migrateLegacyProjectDirectories(projectRoot: string) {
    for (const [key, legacyName] of Object.entries(this.legacyFolderNames)) {
      const currentName = this.folderNames[key as keyof StorageFolderNames];
      const legacyPath = path.join(projectRoot, legacyName);
      const currentPath = path.join(projectRoot, currentName);
      if (!fs.existsSync(legacyPath) || fs.existsSync(currentPath)) {
        continue;
      }
      fs.renameSync(legacyPath, currentPath);
    }
  }

  private listFilesRecursively(root: string): string[] {
    const files: string[] = [];
    const stack = [root];

    while (stack.length) {
      const current = stack.pop() as string;
      const entries = fs
        .readdirSync(current, { withFileTypes: true })
        .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }));

      for (const entry of entries) {
        const absolutePath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(absolutePath);
          continue;
        }

        if (entry.isFile()) {
          files.push(absolutePath);
        }
      }
    }

    return files.sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
  }

  private getTrashRoot() {
    return path.join(path.dirname(this.storageRoot), 'trash');
  }

  private createFolderRetentionEntry(
    category: TrashRetentionCategory,
    relativePath: string,
    retentionDays: number,
    deletedAt: string
  ): TrashRetentionEntry {
    return {
      category,
      relativePath: toUnixPath(relativePath),
      retentionDays,
      deleteAfter: this.addDaysIso(deletedAt, retentionDays)
    };
  }

  private addDaysIso(isoDate: string, days: number) {
    return new Date(new Date(isoDate).getTime() + days * 24 * 60 * 60 * 1000).toISOString();
  }

  private formatTrashTimestamp(isoDate: string) {
    return isoDate.replace(/[:.]/g, '-');
  }

  private createUniqueTrashPath(scope: string, name: string) {
    const root = path.join(this.getTrashRoot(), scope);
    let candidate = path.join(root, name);
    let counter = 1;
    while (fs.existsSync(candidate)) {
      candidate = path.join(root, `${name}-${counter}`);
      counter += 1;
    }
    return candidate;
  }

  private requireStorageRelativePath(absolutePath: string) {
    const resolvedRoot = path.resolve(this.storageRoot);
    const resolvedPath = path.resolve(absolutePath);
    const relative = path.relative(resolvedRoot, resolvedPath);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`Refusing to archive a path outside the storage root: ${absolutePath}`);
    }
    return relative;
  }

  private readTrashManifest(manifestPath: string): { trashRoot?: unknown; entries?: unknown } | null {
    try {
      return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { trashRoot?: unknown; entries?: unknown };
    } catch {
      return null;
    }
  }

  private resolveManifestTrashRoot(manifestPath: string, trashRoot: unknown) {
    if (typeof trashRoot === 'string' && trashRoot.trim()) {
      return path.resolve(trashRoot);
    }
    return path.dirname(manifestPath);
  }

  private normalizeManifestEntries(entries: unknown): TrashRetentionEntry[] {
    if (!Array.isArray(entries)) {
      return [];
    }

    return entries.filter((entry): entry is TrashRetentionEntry => {
      if (!entry || typeof entry !== 'object') {
        return false;
      }
      const value = entry as Partial<TrashRetentionEntry>;
      return (
        typeof value.relativePath === 'string' &&
        typeof value.deleteAfter === 'string' &&
        typeof value.retentionDays === 'number' &&
        typeof value.category === 'string'
      );
    });
  }

  private isPathInside(candidatePath: string, parentPath: string) {
    const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
    return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
  }

  private removePathIfExists(targetPath: string) {
    if (!fs.existsSync(targetPath)) {
      return;
    }

    try {
      fs.rmSync(targetPath, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors; the next cleanup pass can retry.
    }
  }
}

export function createStorageProvider(
  provider: string | undefined,
  options: LocalDiskStorageProviderOptions
): StorageProvider {
  const normalizedProvider = (provider ?? 'local-disk').trim().toLowerCase();
  if (normalizedProvider === 'local-disk') {
    return new LocalDiskStorageProvider(options.storageRoot, options.folderNames, options.legacyFolderNames);
  }

  throw new Error(`Unsupported storage provider: ${provider}`);
}
