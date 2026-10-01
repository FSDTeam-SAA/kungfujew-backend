import { InferSchemaType, Schema } from 'mongoose';

export const SERVICE_LINES = ['vehicle', 'freight', 'heavy-equipment'];
export const SHIPMENT_STATUSES = [
  'pending',
  'in_transit',
  'delivered',
  'cancelled',
];
const requiredText = { type: String, required: true, trim: true };

export const StorySchema = new Schema(
  {
    title: requiredText,
    slug: { ...requiredText, unique: true, lowercase: true },
    metaDescription: requiredText,
    content: requiredText,
    pickupLocation: requiredText,
    destination: requiredText,
    shipmentType: requiredText,
    serviceLine: { ...requiredText, enum: SERVICE_LINES },
    shipmentStatus: {
      ...requiredText,
      enum: SHIPMENT_STATUSES,
      default: 'pending',
    },
    image: String,
    imageAlt: String,
    faqs: [
      new Schema(
        { question: requiredText, answer: requiredText },
        { _id: false },
      ),
    ],
    isPublished: { type: Boolean, default: false },
  },
  { timestamps: true, collection: 'realshipmentstories' },
);

export const ProjectSchema = new Schema(
  {
    name: requiredText,
    type: { ...requiredText, enum: ['web', 'app'] },
    figmaLink: String,
    websiteLink: String,
    adminLink: String,
    category: String,
    profile: String,
  },
  { timestamps: true, collection: 'projects' },
);

export type Story = InferSchemaType<typeof StorySchema>;
export type Project = InferSchemaType<typeof ProjectSchema>;
