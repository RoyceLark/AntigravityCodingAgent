import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

/**
 * Represents a single feedback comment or reply
 */
export interface FeedbackComment {
  id: string;
  artifactId: string;
  agentId: string;
  author: 'user' | 'agent';
  text: string;
  selection?: {
    startLine: number;
    endLine: number;
    startCol?: number;
    endCol?: number;
  };
  threadId?: string;
  parentCommentId?: string;
  resolved: boolean;
  resolvedAt?: Date;
  resolvedBy?: 'user' | 'agent';
  createdAt: Date;
  updatedAt: Date;
  appliedAt?: Date;
}

/**
 * Represents a threaded conversation about feedback
 */
export interface FeedbackThread {
  id: string;
  artifactId: string;
  agentId: string;
  rootComment: FeedbackComment;
  replies: FeedbackComment[];
  resolved: boolean;
  createdAt: Date;
}

/**
 * Summary statistics for feedback on an artifact or agent
 */
export interface FeedbackSummary {
  totalComments: number;
  unresolvedComments: number;
  resolvedComments: number;
  threadCount: number;
  lastActivity?: Date;
}

/**
 * Internal storage structure for persistence
 */
interface FeedbackStore {
  version: string;
  comments: FeedbackComment[];
  threads: FeedbackThread[];
  lastModified: string;
}

/**
 * Production-grade Feedback Service for VS Code extension
 * Implements Google Docs-style commenting system for agent-generated artifacts
 */
export class FeedbackService {
  private static readonly STORAGE_KEY = 'feedback.store';
  private static readonly VERSION = '1.0.0';

  private context: vscode.ExtensionContext;
  private comments: Map<string, FeedbackComment>;
  private threads: Map<string, FeedbackThread>;
  private commentsByArtifact: Map<string, string[]>;
  private commentsByAgent: Map<string, string[]>;

  // Event emitters
  private _onCommentAdded = new vscode.EventEmitter<FeedbackComment>();
  private _onCommentResolved = new vscode.EventEmitter<FeedbackComment>();
  private _onFeedbackApplied = new vscode.EventEmitter<FeedbackComment>();

  readonly onCommentAdded = this._onCommentAdded.event;
  readonly onCommentResolved = this._onCommentResolved.event;
  readonly onFeedbackApplied = this._onFeedbackApplied.event;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.comments = new Map();
    this.threads = new Map();
    this.commentsByArtifact = new Map();
    this.commentsByAgent = new Map();

    this.loadFromStorage();
  }

  /**
   * Load feedback data from persistent storage
   */
  private loadFromStorage(): void {
    try {
      const stored = this.context.globalState.get<string>(FeedbackService.STORAGE_KEY);
      if (!stored) {
        return;
      }

      const store = JSON.parse(stored) as FeedbackStore;

      // Validate version compatibility
      if (!this.isVersionCompatible(store.version)) {
        console.warn(`Feedback store version ${store.version} may not be compatible`);
      }

      // Restore comments with proper date parsing
      store.comments.forEach((comment) => {
        const restoredComment = this.deserializeComment(comment);
        this.comments.set(restoredComment.id, restoredComment);

        // Rebuild artifact index
        if (!this.commentsByArtifact.has(restoredComment.artifactId)) {
          this.commentsByArtifact.set(restoredComment.artifactId, []);
        }
        this.commentsByArtifact.get(restoredComment.artifactId)!.push(restoredComment.id);

        // Rebuild agent index
        if (!this.commentsByAgent.has(restoredComment.agentId)) {
          this.commentsByAgent.set(restoredComment.agentId, []);
        }
        this.commentsByAgent.get(restoredComment.agentId)!.push(restoredComment.id);
      });

      // Restore threads
      store.threads.forEach((thread) => {
        const restoredThread = this.deserializeThread(thread);
        this.threads.set(restoredThread.id, restoredThread);
      });
    } catch (error) {
      console.error('Failed to load feedback from storage:', error);
      // Continue with empty state on load failure
    }
  }

  /**
   * Persist feedback data to storage
   */
  private async saveToStorage(): Promise<void> {
    try {
      const store: FeedbackStore = {
        version: FeedbackService.VERSION,
        comments: Array.from(this.comments.values()),
        threads: Array.from(this.threads.values()),
        lastModified: new Date().toISOString(),
      };

      await this.context.globalState.update(
        FeedbackService.STORAGE_KEY,
        JSON.stringify(store)
      );
    } catch (error) {
      console.error('Failed to save feedback to storage:', error);
      throw new Error(`Failed to persist feedback: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Check if stored version is compatible with current version
   */
  private isVersionCompatible(storedVersion: string): boolean {
    const [storedMajor] = storedVersion.split('.').map(Number);
    const [currentMajor] = FeedbackService.VERSION.split('.').map(Number);
    return storedMajor === currentMajor;
  }

  /**
   * Deserialize a comment from JSON (restore Date objects)
   */
  private deserializeComment(data: any): FeedbackComment {
    return {
      ...data,
      createdAt: new Date(data.createdAt),
      updatedAt: new Date(data.updatedAt),
      resolvedAt: data.resolvedAt ? new Date(data.resolvedAt) : undefined,
      appliedAt: data.appliedAt ? new Date(data.appliedAt) : undefined,
    };
  }

  /**
   * Deserialize a thread from JSON (restore Date objects and comment dates)
   */
  private deserializeThread(data: any): FeedbackThread {
    return {
      ...data,
      createdAt: new Date(data.createdAt),
      rootComment: this.deserializeComment(data.rootComment),
      replies: data.replies.map((reply: any) => this.deserializeComment(reply)),
    };
  }

  /**
   * Add a new feedback comment
   */
  public addComment(
    agentId: string,
    artifactId: string,
    text: string,
    options?: {
      selection?: FeedbackComment['selection'];
      threadId?: string;
      author?: 'user' | 'agent';
    }
  ): FeedbackComment {
    if (!agentId || !artifactId || !text) {
      throw new Error('agentId, artifactId, and text are required');
    }

    if (text.length === 0 || text.length > 10000) {
      throw new Error('Comment text must be between 1 and 10000 characters');
    }

    const author = options?.author || 'user';
    const now = new Date();

    const comment: FeedbackComment = {
      id: uuidv4(),
      artifactId,
      agentId,
      author,
      text,
      selection: options?.selection,
      threadId: options?.threadId,
      resolved: false,
      createdAt: now,
      updatedAt: now,
    };

    // If this is part of a thread, set parent comment ID
    if (options?.threadId) {
      const thread = this.threads.get(options.threadId);
      if (!thread) {
        throw new Error(`Thread ${options.threadId} not found`);
      }
      comment.parentCommentId = thread.rootComment.id;
    }

    // Store comment
    this.comments.set(comment.id, comment);

    // Update artifact index
    if (!this.commentsByArtifact.has(artifactId)) {
      this.commentsByArtifact.set(artifactId, []);
    }
    this.commentsByArtifact.get(artifactId)!.push(comment.id);

    // Update agent index
    if (!this.commentsByAgent.has(agentId)) {
      this.commentsByAgent.set(agentId, []);
    }
    this.commentsByAgent.get(agentId)!.push(comment.id);

    // If this is a reply to an existing comment, update the thread
    if (options?.threadId) {
      const thread = this.threads.get(options.threadId);
      if (thread) {
        thread.replies.push(comment);
      }
    } else {
      // Create a new thread if this is a root comment
      const thread: FeedbackThread = {
        id: uuidv4(),
        artifactId,
        agentId,
        rootComment: comment,
        replies: [],
        resolved: false,
        createdAt: now,
      };
      this.threads.set(thread.id, thread);
      comment.threadId = thread.id;
    }

    this.saveToStorage().catch((error) => {
      console.error('Failed to save comment to storage:', error);
    });

    this._onCommentAdded.fire(comment);
    return comment;
  }

  /**
   * Reply to an existing comment
   */
  public replyToComment(
    commentId: string,
    text: string,
    author?: 'user' | 'agent'
  ): FeedbackComment {
    const parentComment = this.comments.get(commentId);
    if (!parentComment) {
      throw new Error(`Comment ${commentId} not found`);
    }

    if (!parentComment.threadId) {
      throw new Error('Parent comment does not belong to a thread');
    }

    return this.addComment(
      parentComment.agentId,
      parentComment.artifactId,
      text,
      {
        threadId: parentComment.threadId,
        author: author || 'user',
      }
    );
  }

  /**
   * Mark a single comment as resolved
   */
  public resolveComment(
    commentId: string,
    resolvedBy?: 'user' | 'agent'
  ): void {
    const comment = this.comments.get(commentId);
    if (!comment) {
      throw new Error(`Comment ${commentId} not found`);
    }

    const now = new Date();
    comment.resolved = true;
    comment.resolvedAt = now;
    comment.resolvedBy = resolvedBy || 'user';
    comment.updatedAt = now;

    this.saveToStorage().catch((error) => {
      console.error('Failed to save comment resolution to storage:', error);
    });

    this._onCommentResolved.fire(comment);
  }

  /**
   * Mark all comments in a thread as resolved
   */
  public resolveThread(
    threadId: string,
    resolvedBy?: 'user' | 'agent'
  ): void {
    const thread = this.threads.get(threadId);
    if (!thread) {
      throw new Error(`Thread ${threadId} not found`);
    }

    const now = new Date();
    const resolver = resolvedBy || 'user';

    // Resolve root comment
    this.resolveComment(thread.rootComment.id, resolver);

    // Resolve all replies
    thread.replies.forEach((reply) => {
      this.resolveComment(reply.id, resolver);
    });

    // Mark thread as resolved
    thread.resolved = true;
  }

  /**
   * Get all comments for an artifact
   */
  public getComments(artifactId: string): FeedbackComment[] {
    const commentIds = this.commentsByArtifact.get(artifactId) || [];
    return commentIds
      .map((id) => this.comments.get(id))
      .filter((comment): comment is FeedbackComment => comment !== undefined)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  /**
   * Get all threads for an artifact
   */
  public getThreads(artifactId: string): FeedbackThread[] {
    return Array.from(this.threads.values())
      .filter((thread) => thread.artifactId === artifactId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  /**
   * Get all unresolved comments for an agent
   */
  public getUnresolvedComments(agentId: string): FeedbackComment[] {
    const commentIds = this.commentsByAgent.get(agentId) || [];
    return commentIds
      .map((id) => this.comments.get(id))
      .filter((comment): comment is FeedbackComment =>
        comment !== undefined && !comment.resolved
      )
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  /**
   * Get feedback summary statistics
   */
  public getFeedbackSummary(agentId: string): FeedbackSummary {
    const commentIds = this.commentsByAgent.get(agentId) || [];
    const comments = commentIds
      .map((id) => this.comments.get(id))
      .filter((comment): comment is FeedbackComment => comment !== undefined);

    const resolved = comments.filter((c) => c.resolved);
    const unresolved = comments.filter((c) => !c.resolved);

    const threads = Array.from(this.threads.values()).filter(
      (thread) => thread.agentId === agentId
    );

    const lastActivity = comments.length > 0
      ? new Date(Math.max(...comments.map((c) => c.updatedAt.getTime())))
      : undefined;

    return {
      totalComments: comments.length,
      unresolvedComments: unresolved.length,
      resolvedComments: resolved.length,
      threadCount: threads.length,
      lastActivity,
    };
  }

  /**
   * Generate a structured prompt for the agent to incorporate feedback
   */
  public generateFeedbackPrompt(agentId: string): string {
    const unresolvedComments = this.getUnresolvedComments(agentId);

    if (unresolvedComments.length === 0) {
      return '';
    }

    const threads = Array.from(this.threads.values())
      .filter((thread) => thread.agentId === agentId && !thread.resolved)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    let prompt = '# User Feedback to Incorporate\n\n';
    prompt += `There are ${unresolvedComments.length} unresolved feedback comment(s) from the user:\n\n`;

    threads.forEach((thread, index) => {
      prompt += `## Feedback ${index + 1}\n`;
      prompt += `**From:** ${thread.rootComment.author === 'user' ? 'User' : 'Agent'}\n`;
      prompt += `**Date:** ${thread.rootComment.createdAt.toISOString()}\n`;

      if (thread.rootComment.selection) {
        const { startLine, endLine, startCol, endCol } = thread.rootComment.selection;
        prompt += `**Location:** Lines ${startLine}-${endLine}`;
        if (startCol !== undefined && endCol !== undefined) {
          prompt += ` (columns ${startCol}-${endCol})`;
        }
        prompt += '\n';
      }

      prompt += `**Comment:** ${thread.rootComment.text}\n`;

      if (thread.replies.length > 0) {
        prompt += '\n**Conversation:**\n';
        thread.replies.forEach((reply) => {
          prompt += `- ${reply.author === 'user' ? 'User' : 'Agent'} (${reply.createdAt.toISOString()}): ${reply.text}\n`;
        });
      }

      prompt += '\n';
    });

    prompt += '## Instructions\n';
    prompt += 'Please incorporate the above feedback into your response. After making changes, ';
    prompt += 'indicate which feedback items you have addressed.\n';

    return prompt;
  }

  /**
   * Mark feedback as applied by the agent
   */
  public markFeedbackApplied(commentId: string): void {
    const comment = this.comments.get(commentId);
    if (!comment) {
      throw new Error(`Comment ${commentId} not found`);
    }

    const now = new Date();
    comment.appliedAt = now;
    comment.updatedAt = now;

    this.saveToStorage().catch((error) => {
      console.error('Failed to save feedback applied status to storage:', error);
    });

    this._onFeedbackApplied.fire(comment);
  }

  /**
   * Export all feedback for an artifact as formatted markdown
   */
  public exportFeedback(artifactId: string): string {
    const threads = this.getThreads(artifactId);

    if (threads.length === 0) {
      return '# No Feedback\n\nThere are no feedback comments for this artifact.';
    }

    let markdown = `# Feedback Export\n\n`;
    markdown += `**Artifact ID:** ${artifactId}\n`;
    markdown += `**Export Date:** ${new Date().toISOString()}\n`;
    markdown += `**Total Comments:** ${this.getComments(artifactId).length}\n\n`;

    threads.forEach((thread, index) => {
      const statusIcon = thread.resolved ? '✓' : '○';
      markdown += `## ${statusIcon} Feedback Thread ${index + 1}\n`;
      markdown += `**Status:** ${thread.resolved ? 'Resolved' : 'Unresolved'}\n`;
      markdown += `**Created:** ${thread.createdAt.toISOString()}\n\n`;

      // Root comment
      markdown += `### Root Comment\n`;
      markdown += `**Author:** ${thread.rootComment.author === 'user' ? 'User' : 'Agent'}\n`;
      markdown += `**Date:** ${thread.rootComment.createdAt.toISOString()}\n`;

      if (thread.rootComment.selection) {
        const { startLine, endLine, startCol, endCol } = thread.rootComment.selection;
        markdown += `**Location:** Lines ${startLine}-${endLine}`;
        if (startCol !== undefined && endCol !== undefined) {
          markdown += ` (columns ${startCol}-${endCol})`;
        }
        markdown += '\n';
      }

      if (thread.rootComment.resolved) {
        markdown += `**Resolved:** Yes (by ${thread.rootComment.resolvedBy || 'unknown'} on ${thread.rootComment.resolvedAt?.toISOString() || 'unknown date'})\n`;
      }

      if (thread.rootComment.appliedAt) {
        markdown += `**Applied:** Yes (${thread.rootComment.appliedAt.toISOString()})\n`;
      }

      markdown += `\n${thread.rootComment.text}\n\n`;

      // Replies
      if (thread.replies.length > 0) {
        markdown += `### Replies\n\n`;
        thread.replies.forEach((reply, replyIndex) => {
          const replyStatus = reply.resolved ? '✓' : '○';
          markdown += `#### ${replyStatus} Reply ${replyIndex + 1}\n`;
          markdown += `**Author:** ${reply.author === 'user' ? 'User' : 'Agent'}\n`;
          markdown += `**Date:** ${reply.createdAt.toISOString()}\n`;

          if (reply.resolved) {
            markdown += `**Resolved:** Yes (by ${reply.resolvedBy || 'unknown'} on ${reply.resolvedAt?.toISOString() || 'unknown date'})\n`;
          }

          if (reply.appliedAt) {
            markdown += `**Applied:** Yes (${reply.appliedAt.toISOString()})\n`;
          }

          markdown += `\n${reply.text}\n\n`;
        });
      }

      markdown += '---\n\n';
    });

    return markdown;
  }

  /**
   * Clear all feedback for an agent (optionally for specific artifact)
   */
  public clearFeedback(agentId: string, artifactId?: string): void {
    const commentIds = this.commentsByAgent.get(agentId) || [];
    const commentsToClear = commentIds
      .map((id) => this.comments.get(id))
      .filter(
        (comment): comment is FeedbackComment =>
          comment !== undefined && (!artifactId || comment.artifactId === artifactId)
      );

    if (commentsToClear.length === 0) {
      return;
    }

    // Remove comments
    commentsToClear.forEach((comment) => {
      this.comments.delete(comment.id);

      // Update artifact index
      const artifactComments = this.commentsByArtifact.get(comment.artifactId);
      if (artifactComments) {
        const index = artifactComments.indexOf(comment.id);
        if (index > -1) {
          artifactComments.splice(index, 1);
        }
      }
    });

    // Remove agent index entry if empty
    const updatedCommentIds = this.commentsByAgent.get(agentId) || [];
    const remaining = updatedCommentIds.filter((id) => this.comments.has(id));
    if (remaining.length === 0) {
      this.commentsByAgent.delete(agentId);
    } else {
      this.commentsByAgent.set(agentId, remaining);
    }

    // Remove threads related to cleared comments
    const threadsToRemove: string[] = [];
    this.threads.forEach((thread, threadId) => {
      if (!artifactId || thread.artifactId === artifactId) {
        if (!this.comments.has(thread.rootComment.id)) {
          threadsToRemove.push(threadId);
        }
      }
    });

    threadsToRemove.forEach((threadId) => {
      this.threads.delete(threadId);
    });

    this.saveToStorage().catch((error) => {
      console.error('Failed to save feedback clearance to storage:', error);
    });
  }

  /**
   * Get a comment by ID
   */
  public getCommentById(commentId: string): FeedbackComment | undefined {
    return this.comments.get(commentId);
  }

  /**
   * Get a thread by ID
   */
  public getThreadById(threadId: string): FeedbackThread | undefined {
    return this.threads.get(threadId);
  }

  /**
   * Update comment text (for editing)
   */
  public updateCommentText(commentId: string, newText: string): FeedbackComment {
    const comment = this.comments.get(commentId);
    if (!comment) {
      throw new Error(`Comment ${commentId} not found`);
    }

    if (newText.length === 0 || newText.length > 10000) {
      throw new Error('Comment text must be between 1 and 10000 characters');
    }

    comment.text = newText;
    comment.updatedAt = new Date();

    this.saveToStorage().catch((error) => {
      console.error('Failed to save comment update to storage:', error);
    });

    return comment;
  }

  /**
   * Get statistics across all feedback
   */
  public getGlobalStatistics(): {
    totalComments: number;
    totalThreads: number;
    totalAgents: number;
    totalArtifacts: number;
    unresolvedComments: number;
  } {
    return {
      totalComments: this.comments.size,
      totalThreads: this.threads.size,
      totalAgents: this.commentsByAgent.size,
      totalArtifacts: this.commentsByArtifact.size,
      unresolvedComments: Array.from(this.comments.values()).filter((c) => !c.resolved).length,
    };
  }

  /**
   * Dispose of the service and clean up event emitters
   */
  public dispose(): void {
    this._onCommentAdded.dispose();
    this._onCommentResolved.dispose();
    this._onFeedbackApplied.dispose();
  }
}
