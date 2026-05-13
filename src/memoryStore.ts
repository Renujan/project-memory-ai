import * as path from 'path';
import * as fs from 'fs/promises';

export interface ProjectMemory {
    timestamp: number;
    summary: string;
    suggestions?: string[];
    filesEdited: string[];
    todosRemaining: number;
}

/**
 * MemoryStore class to manage local storage using JSON files.
 */
export class MemoryStore {
    private dbPath: string;
    private dirPath: string;

    /**
     * Creates an instance of MemoryStore.
     * @param {string} workspaceRoot - The root path of the workspace.
     */
    constructor(workspaceRoot: string) {
        this.dirPath = path.join(workspaceRoot, '.vscode', 'project-memory');
        this.dbPath = path.join(this.dirPath, 'memory.json');
    }

    /**
     * Initializes the memory store index.
     * @returns {Promise<void>}
     */
    public async initialize(): Promise<void> {
        try {
            await fs.mkdir(this.dirPath, { recursive: true });
            
            try {
                await fs.access(this.dbPath);
            } catch {
                // File doesn't exist, create it with empty array
                await fs.writeFile(this.dbPath, JSON.stringify([], null, 2), 'utf-8');
            }
        } catch (error) {
            console.error("Failed to initialize MemoryStore", error);
        }
    }

    /**
     * Saves a project summary to the JSON store.
     * @param {ProjectMemory} memory - The memory object to save.
     * @returns {Promise<void>}
     */
    public async saveMemory(memory: ProjectMemory): Promise<void> {
        try {
            const data = await fs.readFile(this.dbPath, 'utf-8');
            const memories: ProjectMemory[] = JSON.parse(data);
            
            memories.push(memory);
            
            await fs.writeFile(this.dbPath, JSON.stringify(memories, null, 2), 'utf-8');
        } catch (error) {
            console.error("Failed to save memory", error);
            throw error;
        }
    }

    /**
     * Retrieves the most recent memory from the JSON store.
     * @returns {Promise<ProjectMemory | null>} The most recent memory, or null if none.
     */
    public async getRecentMemory(): Promise<ProjectMemory | null> {
        try {
            const data = await fs.readFile(this.dbPath, 'utf-8');
            const memories: ProjectMemory[] = JSON.parse(data);
            
            if (!memories || memories.length === 0) {
                return null;
            }

            // Sort items by timestamp descending
            memories.sort((a, b) => b.timestamp - a.timestamp);
            return memories[0];
        } catch (error) {
            console.error("Failed to get recent memory", error);
            return null;
        }
    }

    /**
     * Clears all memories in the workspace.
     * @returns {Promise<void>}
     */
    public async clearMemory(): Promise<void> {
        try {
            await fs.writeFile(this.dbPath, JSON.stringify([], null, 2), 'utf-8');
        } catch (error) {
            console.error("Failed to clear memory", error);
            throw error;
        }
    }
}
