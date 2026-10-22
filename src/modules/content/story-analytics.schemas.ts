import { InferSchemaType, Schema } from 'mongoose';

export const StoryVisitSchema = new Schema(
  {
    storyId: { type: Schema.Types.ObjectId, required: true },
    viewId: { type: String, required: true },
    openedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    stage: { type: Number, required: true, min: 0, max: 2 },
  },
  { collection: 'storyvisits', versionKey: false },
);

StoryVisitSchema.index({ storyId: 1, viewId: 1 }, { unique: true });
StoryVisitSchema.index({ storyId: 1, openedAt: 1 });
StoryVisitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// This singleton survives visit expiry so the tracking start never moves forward.
export const StoryTrackingSchema = new Schema(
  {
    _id: { type: String },
    startedAt: { type: Date, required: true },
  },
  { collection: 'storytracking', versionKey: false },
);

export type StoryVisit = InferSchemaType<typeof StoryVisitSchema>;
export type StoryTracking = InferSchemaType<typeof StoryTrackingSchema>;
