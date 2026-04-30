import type express from 'express';
import type multer from 'multer';
import type { ProjectProcessor } from '../processor.js';
import type { LocalStore } from '../store.js';

export interface RouteContext {
  store: LocalStore;
  processor: ProjectProcessor;
  upload?: multer.Multer;
  featureImageUpload?: multer.Multer;
  [key: string]: any;
}
